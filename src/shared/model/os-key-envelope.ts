// Errors of the OS envelopes (S5, S6). None of them ever carries the data key, the sealed
// bytes or the key store's raw output.
import type { OsEnvelopeUnavailable, OsEnvelopeUnavailableReason } from "../types/os-key-envelope";

/** The sealed bytes were changed, or belong to another user, machine or name. It never says which. */
export class OsEnvelopeOpenError extends Error {
  override name = "OsEnvelopeOpenError";
  constructor() {
    super(
      "The OS key envelope could not be opened: it was changed, or it belongs to another user, machine or name.",
    );
  }
}

/**
 * The OS key store cannot be used here or now. It never means a lost key: the sealed data key
 * stays as it is, and goop never makes a new one over existing data (S9).
 */
export class OsEnvelopeUnavailableError extends Error {
  override name = "OsEnvelopeUnavailableError";
  readonly reason: OsEnvelopeUnavailableReason;
  constructor(unavailable: OsEnvelopeUnavailable) {
    super(unavailable.message);
    this.reason = unavailable.reason;
  }
}

/** The OS key store is usable but did not seal the data key. */
export class OsEnvelopeSealError extends Error {
  override name = "OsEnvelopeSealError";
  constructor(detail: string) {
    super(`The OS key store could not seal the data key: ${detail}.`);
  }
}
