// Wraps a data key with `systemd-creds --user` (host key + TPM2, scoped to the calling user).
// The key only travels through stdin and stdout: never argv, never a file.

export const CREDENTIAL_NAME = "goop-dek";

async function run(args: string[], input: Uint8Array): Promise<Uint8Array> {
  const child = Bun.spawn(["systemd-creds", "--user", ...args], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  child.stdin.write(input);
  await child.stdin.end();
  const [output, error, code] = await Promise.all([
    new Response(child.stdout).bytes(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`systemd-creds ${args[0]} exited ${code}: ${error.trim()}`);
  return output;
}

/** Returns the encrypted credential (base64 text, as systemd-creds writes it). */
export function wrapWithTpm(key: Uint8Array, name = CREDENTIAL_NAME): Promise<Uint8Array> {
  return run(["encrypt", `--name=${name}`, "-", "-"], key);
}

export function unwrapWithTpm(credential: Uint8Array, name = CREDENTIAL_NAME): Promise<Uint8Array> {
  return run(["decrypt", `--name=${name}`, "-", "-"], credential);
}
