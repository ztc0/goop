// Makes a development folder private to this user (0700), such as `.temp/run/`, which holds the
// daemon's socket. The channel refuses a runtime folder open to others and never changes it; in
// development the folder lives in the repo and is ours, so the dev environment tightens it here.
import { chmodSync, lstatSync, mkdirSync } from "node:fs";

const PRIVATE_MODE = 0o700;

/**
 * Creates `folder` 0700, or tightens it to 0700 when it is a folder this user owns. A symbolic
 * link or a folder owned by someone else is left unchanged, for the channel to refuse.
 */
export function ensurePrivateFolder(folder: string): void {
  mkdirSync(folder, { recursive: true, mode: PRIVATE_MODE });
  const facts = lstatSync(folder);
  if (!facts.isDirectory() || facts.uid !== process.getuid?.()) return;
  if ((facts.mode & 0o777) !== PRIVATE_MODE) chmodSync(folder, PRIVATE_MODE);
}
