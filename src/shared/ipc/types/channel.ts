// The channel port (S8): what the TUI and the daemon see of the private channel between them.
// Each system brings its own adapter; nothing here depends on how the bytes travel.
import type { JsonRpcMessage, ParsedMessage } from "@/shared/ipc/types/json-rpc";

/** One open connection, seen from either end. */
export interface ChannelConnection {
  /** Sends one message; throws, sending nothing, when the other side would refuse it. */
  send(message: JsonRpcMessage): void;
  close(): void;
}

/** What one end does with a connection. */
export interface ChannelEvents {
  /** Each message that arrives, or the error to answer it with when it is invalid. */
  message(message: ParsedMessage): void;
  /** The connection closed, from either end. A message that was too large closes it too. */
  close(): void;
}

/** The daemon's open channel. */
export interface ChannelListener {
  /** Stops accepting connections, closes the open ones and frees the channel's name. */
  close(): Promise<void>;
}

export interface Channel {
  /** The daemon's side: one listener at a time; `accept` runs for each new connection. */
  listen(accept: (connection: ChannelConnection) => ChannelEvents): Promise<ChannelListener>;
  /** The TUI's side: connects to the running daemon. */
  connect(events: ChannelEvents): Promise<ChannelConnection>;
}
