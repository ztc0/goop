// The pure side of the Windows OS envelope (S6): DPAPI's settings, the reading of its error
// codes and the retry schedule. The adapter `adapters/dpapi-envelope` makes the calls.

/** Mixed into every blob: a blob sealed for another purpose, or by another app, does not open. */
export const DPAPI_ENTROPY = "goop-dek-v1";
/** wincrypt.h: fail instead of showing a prompt. goop's daemon has no desktop to show one. */
export const CRYPTPROTECT_UI_FORBIDDEN = 0x1;

/**
 * The waits between attempts while DPAPI is busy. After another user logged on, the T11 spike
 * saw DPAPI fail for about 20-40 s; 1+2+4+8+16 s stops at 31 s, inside that window, so a last
 * wait of 16 s takes the total to 47 s: past the worst case seen, still under a minute.
 */
export const DPAPI_RETRY_WAITS_MS: readonly number[] = [1000, 2000, 4000, 8000, 16000, 16000];

/** ERROR_ACCESS_DENIED and NTE_BAD_KEY_STATE: both seen in T11 while DPAPI was busy (ADR 0002). */
const TRANSIENT_CODES: ReadonlySet<number> = new Set([0x5, 0x8009000b]);

export type DpapiAction = "protect" | "unprotect";
export type DpapiFailure = "transient" | "open-failed" | "seal-failed";

/**
 * What a `GetLastError` code means. A busy key store is retried, never read as a lost key (S9);
 * any other failure to open, `ERROR_INVALID_DATA` (`0xd`) included, is the one open error.
 */
export function classifyDpapiError(action: DpapiAction, code: number): DpapiFailure {
  if (TRANSIENT_CODES.has(code)) return "transient";
  return action === "unprotect" ? "open-failed" : "seal-failed";
}

/** `0x5` as `0x00000005`, the way Windows documents its codes. */
export function hexCode(code: number): string {
  return `0x${(code >>> 0).toString(16).padStart(8, "0")}`;
}
