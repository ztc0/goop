// Copies an embedded native library to a cache folder and checks its sha256 before it is loaded.
// `bun build --compile` keeps embedded files under /$bunfs/, which dlopen cannot read.
import { chmodSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";

export async function sha256File(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await Bun.file(path).arrayBuffer());
  return hasher.digest("hex");
}

/**
 * Returns the path of a verified copy of `source` under `cacheRoot/<hash prefix>/<name>`.
 * Throws when the embedded bytes or the cached copy do not match `expectedSha256`.
 */
export async function installNative(
  source: string,
  name: string,
  expectedSha256: string,
  cacheRoot: string,
): Promise<string> {
  const embedded = await sha256File(source);
  if (embedded !== expectedSha256) {
    throw new Error(`embedded ${name} sha256 ${embedded} does not match ${expectedSha256}`);
  }
  const folder = join(cacheRoot, expectedSha256.slice(0, 16));
  const target = join(folder, name);
  if (!existsSync(target) || (await sha256File(target)) !== expectedSha256) {
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const partial = `${target}.${process.pid}.part`;
    await Bun.write(partial, Bun.file(source));
    chmodSync(partial, 0o500);
    renameSync(partial, target);
  }
  const cached = await sha256File(target);
  if (cached !== expectedSha256) {
    throw new Error(`cached ${name} sha256 ${cached} does not match ${expectedSha256}`);
  }
  return target;
}
