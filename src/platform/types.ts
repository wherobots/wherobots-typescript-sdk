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

export interface AuthCredentials {
  token?: string | undefined;
  apiKey?: string | undefined;
}

// The slice of the WebSocket API the SDK actually uses. Declaring it
// explicitly documents exactly which methods/events core code may rely on, and
// lets both the browser's native WebSocket and Node's `ws` socket satisfy the
// contract directly — neither has to be cast to a full DOM WebSocket. Core
// code only ever sends already-serialized strings and listens for the
// open/error/close/message events via add/removeEventListener.
export interface SocketApiSubset {
  send(data: string): void;
  close(): void;
  addEventListener<E extends keyof WebSocketEventMap>(
    type: E,
    listener: (event: WebSocketEventMap[E]) => void,
    options?: AddEventListenerOptions,
  ): void;
  removeEventListener<E extends keyof WebSocketEventMap>(
    type: E,
    listener: (event: WebSocketEventMap[E]) => void,
  ): void;
}

// Opens (but does not await) a connection. Node's `ws` socket and the browser's
// native WebSocket both implement this subset of the DOM WebSocket interface,
// so the rest of the SDK can treat them uniformly — the only difference is how
// the socket is constructed and authenticated.
export type OpenSocket = (
  url: string,
  auth: AuthCredentials,
) => SocketApiSubset;

// The capabilities that differ between Node and the browser. Core SDK code
// depends only on this interface, imported from the `@platform` alias.
export interface Platform {
  openSocket: OpenSocket;
  decompress(
    payload: Uint8Array,
    compression: DataCompression,
  ): Promise<Uint8Array>;
  // The User-Agent the REST client should send, or undefined when the runtime
  // doesn't allow overriding it (browsers drop a JS-set User-Agent).
  userAgent(): string | undefined;
  // The `plat=` value for this runtime's X-Wherobots-Client hop. Node reports
  // its OS; the browser reports the runtime, since it has no OS it could name
  // honestly. This lives on the Platform interface rather than behind a
  // `typeof process` guard so that `process.platform` never reaches the
  // browser bundle at all (asserted by bundle.smoke.test.ts).
  clientPlatform: NodeJS.Platform | "browser";
  // The default result compression to request when the consumer hasn't chosen
  // one: brotli in Node, gzip in the browser.
  defaultCompression: DataCompression;
  createLogger(options: LoggerOptions): Logger;
}
