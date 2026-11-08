import type { CosignPin, SignedChecksums } from "../types/native-libs";

/**
 * The cosign that checks a release's signature: v2.6.5, the last 2.x, whose `verify-blob`
 * takes a separate signature and certificate as sqlite3mc publishes them. Its sha256 is the one
 * the release's `cosign_checksums.txt` and GitHub's asset digest both give.
 */
export const COSIGN: CosignPin = {
  name: "cosign-linux-amd64",
  version: "v2.6.5",
  url: "https://github.com/sigstore/cosign/releases/download/v2.6.5/cosign-linux-amd64",
  sha256: "c3b4f5410e608af03a5eb0aaac84a4313d8da131248e08ff1759ac70c79d1644",
  maxBytes: 160 * 1024 * 1024,
};

/**
 * `cosign verify-blob` of a keyless signature: the certificate must name exactly this workflow
 * and issuer, and the signature must be in Rekor, the transparency log.
 */
export function cosignArgs(
  signer: Pick<SignedChecksums, "identity" | "issuer">,
  files: { list: string; signature: string; certificate: string },
): string[] {
  return [
    "verify-blob",
    "--certificate",
    files.certificate,
    "--signature",
    files.signature,
    "--certificate-identity",
    signer.identity,
    "--certificate-oidc-issuer",
    signer.issuer,
    files.list,
  ];
}
