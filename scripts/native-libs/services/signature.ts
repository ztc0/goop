import { join } from "node:path";
import { listedSha256 } from "@scripts/native-libs/model/checks";
import { cosignArgs } from "@scripts/native-libs/model/signature";
import type {
  BuildDeps,
  CosignPin,
  LibraryRecipe,
  RemoteFile,
} from "@scripts/native-libs/types/native-libs";
import { sha256Mismatch } from "@scripts/shared/download";

/**
 * Checks the Cosign signature of the release's checksum list with the pinned cosign, then that
 * the signed list gives the archive its pinned sha256. Undefined when all of it holds, else the
 * error. Without Rekor, cosign fails and so does this: nothing is trusted unchecked.
 */
export async function verifySignature(
  deps: BuildDeps,
  recipe: LibraryRecipe,
  cosign: CosignPin,
): Promise<string | undefined> {
  const { files, output } = deps;
  const { signed, archive } = recipe;
  const fetch = async (file: RemoteFile) => {
    try {
      return await deps.download(file.url, file.maxBytes);
    } catch (error) {
      return `Could not download ${file.name}: ${(error as Error).message}`;
    }
  };

  output.info(`Downloading cosign ${cosign.version}...`);
  const binary = await fetch(cosign);
  if (typeof binary === "string") return binary;
  const mismatch = sha256Mismatch(cosign.name, cosign.sha256, binary);
  if (mismatch !== undefined) return mismatch;
  output.info(`sha256 ok: ${cosign.name}`);

  const parts = [signed.list, signed.signature, signed.certificate];
  output.info(`Downloading ${parts[0]?.name}, ${parts[1]?.name} and ${parts[2]?.name}...`);
  const fetched: Uint8Array[] = [];
  for (const part of parts) {
    const content = await fetch(part);
    if (typeof content === "string") return content;
    fetched.push(content);
  }

  const directory = files.freshDirectory(deps.paths.downloads, "cosign-");
  const program = join(directory, "cosign");
  files.writeNew(program, binary, 0o700);
  parts.forEach((part, index) => {
    files.writeNew(join(directory, part.name), fetched[index] ?? new Uint8Array());
  });
  output.info(
    `Verifying the Cosign signature of ${signed.list.name} (identity ${signed.identity}, issuer ${signed.issuer})...`,
  );
  const verified = await deps.runner.run({
    command: [
      program,
      ...cosignArgs(signed, {
        list: join(directory, signed.list.name),
        signature: join(directory, signed.signature.name),
        certificate: join(directory, signed.certificate.name),
      }),
    ],
    // Sigstore's trust root is cached here, inside the throwaway folder, not in ~/.sigstore.
    env: { TUF_ROOT: join(directory, "tuf") },
    stream: true,
  });
  if (verified.exitCode !== 0) {
    return `Cosign could not verify ${signed.list.name} (exit ${verified.exitCode}). It needs Rekor, the Sigstore transparency log; without that check nothing is trusted.`;
  }

  const listed = listedSha256(new TextDecoder().decode(fetched[0]), archive.name);
  if (listed === undefined) return `${signed.list.name} does not list ${archive.name}.`;
  if (listed !== archive.sha256) {
    return `${signed.list.name} gives ${archive.name} the sha256 ${listed}, not its pin ${archive.sha256}.`;
  }
  output.info(`Signature ok: ${signed.list.name} lists ${archive.name} with its pinned sha256.`);
  return undefined;
}
