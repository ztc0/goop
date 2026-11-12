// How messages travel as bytes (S2): one JSON-RPC message per line, newline-delimited.

/** What one chunk of bytes completed. */
export interface FrameBatch {
  /** Every line the chunk completed, without its newline; empty lines are left out. */
  lines: string[];
  /** A line grew past MAX_MESSAGE_BYTES: the connection must close, nothing more is read. */
  tooLarge: boolean;
}

/** Turns the chunks of one connection, split anywhere, back into lines. */
export interface FrameReader {
  push(chunk: Uint8Array): FrameBatch;
}
