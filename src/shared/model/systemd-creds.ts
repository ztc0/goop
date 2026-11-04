// The pure side of the Linux OS envelope (S5): the argv given to `systemd-creds` and the reading
// of its replies. The adapter `adapters/systemd-creds-envelope` runs it.
import type { OsEnvelopeAvailability } from "../types/os-key-envelope";

/** The name sealed into the credential: decrypting with another name is refused. */
export const CREDENTIAL_NAME = "goop-dek";
/** `--user` exists since systemd 256 (T11 spike, finding 6). */
export const MIN_SYSTEMD_VERSION = 256;

/**
 * The arguments after the executable. The data key and the credential never appear here: `- -`
 * makes `systemd-creds` read stdin and write stdout. `--with-key` only matters when encrypting,
 * and does not prove a TPM2 was used: systemd 257 without one seals with the host key alone, so
 * the adapter checks `has-tpm2` first. No `--no-ask-password`: systemd 257 does not know it.
 */
export function credsArgs(action: "encrypt" | "decrypt"): string[] {
  const key = action === "encrypt" ? ["--with-key=host+tpm2"] : [];
  return ["--user", action, ...key, `--name=${CREDENTIAL_NAME}`, "-", "-"];
}

/** The major version in `systemd-creds --version`: `systemd 262 (262.1-1-arch)` gives 262. */
export function parseSystemdVersion(output: string): number | undefined {
  const match = /^systemd (\d+)\b/.exec(output.trimStart());
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

/**
 * Whether the replies of `systemd-creds --version` and `systemd-creds has-tpm2` allow the OS
 * envelope. `has-tpm2` prints `yes`, `partial` or `no` first and exits 0 only for `yes`.
 */
export function systemdAvailability(
  versionOutput: string,
  tpm2Output: string,
  tpm2ExitCode: number,
): OsEnvelopeAvailability {
  const version = parseSystemdVersion(versionOutput);
  if (version === undefined || version < MIN_SYSTEMD_VERSION) {
    const found =
      version === undefined
        ? "The systemd version could not be read"
        : `systemd ${version} is too old`;
    return {
      available: false,
      reason: "old-version",
      message: `${found}: the OS key store needs systemd ${MIN_SYSTEMD_VERSION} or later.`,
    };
  }
  if (tpm2ExitCode !== 0 || tpm2Output.split("\n", 1)[0]?.trim() !== "yes") {
    return {
      available: false,
      reason: "no-tpm2",
      message: 'No usable TPM2: "systemd-creds has-tpm2" did not report yes.',
    };
  }
  return { available: true };
}
