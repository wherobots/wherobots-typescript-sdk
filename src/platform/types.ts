import { DataCompression } from "../constants";

// Platform-neutral logging interface. The Node implementation wraps pino; the
// browser implementation wraps the console. Only the methods used by the SDK
// are declared.
export interface Logger {
  info(msg: string): void;
  debug(msg: string | object): void;
  warn(msg: string): void;
  error(msg: string): void;
  child(context: object): Logger;
}

export interface LoggerOptions {
  name: string;
  debug: boolean;
  enabled: boolean;
}

// The subset of WebSocket message payloads we may receive across platforms:
// - string: JSON text frames
// - ArrayBuffer/Uint8Array: binary frames (browser native sockets, after
//   setting binaryType="arraybuffer")
// - Uint8Array[]: fragmented binary frames (Node `ws`)
// - Blob: binary frames from a browser socket left at its default binaryType
export type SocketMessageData =
  | string
  | ArrayBuffer
  | Uint8Array
  | Uint8Array[]
  | Blob;

export interface SocketEventMap {
  open: { type: "open" };
  close: { type: "close"; code?: number; reason?: string };
  error: { type: "error"; message?: string };
  message: { type: "message"; data: SocketMessageData };
}

export type SocketEventName = keyof SocketEventMap;

export interface SocketListenerOptions {
  once?: boolean;
}

// Platform-neutral socket handle. Both the Node `ws` socket and the browser
// native WebSocket are adapted to this shape.
export interface SocketLike {
  send(data: string): void;
  close(): void;
  addEventListener<E extends SocketEventName>(
    type: E,
    listener: (e: SocketEventMap[E]) => void,
    options?: SocketListenerOptions,
  ): void;
  removeEventListener<E extends SocketEventName>(
    type: E,
    listener: (e: SocketEventMap[E]) => void,
  ): void;
}

export interface AuthCredentials {
  token?: string | undefined;
  apiKey?: string | undefined;
}

// Opens (but does not await) a connection. Returns immediately, mirroring the
// WebSocket constructor; callers drive readiness off the open/error events.
export type OpenSocket = (url: string, auth: AuthCredentials) => SocketLike;

// The capabilities that differ between Node and the browser. Core SDK code
// depends only on this interface, imported from the `@platform` alias.
export interface Platform {
  openSocket: OpenSocket;
  decompress(
    payload: Uint8Array,
    compression: DataCompression,
  ): Promise<Uint8Array>;
  getEnv(name: string): string | undefined;
  // The User-Agent the REST client should send, or undefined when the runtime
  // forbids overriding it (browsers).
  userAgent(): string | undefined;
  // The default result compression to request when the consumer hasn't chosen
  // one: brotli in Node, gzip in the browser.
  defaultCompression: DataCompression;
  createLogger(options: LoggerOptions): Logger;
}
