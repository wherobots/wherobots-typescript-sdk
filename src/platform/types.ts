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

// Opens (but does not await) a connection, returning a standard WebSocket.
// Node's `ws` socket and the browser's native WebSocket both implement the DOM
// WebSocket interface, so the rest of the SDK can treat them uniformly — the
// only difference is how the socket is constructed and authenticated.
export type OpenSocket = (url: string, auth: AuthCredentials) => WebSocket;

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
  // The default result compression to request when the consumer hasn't chosen
  // one: brotli in Node, gzip in the browser.
  defaultCompression: DataCompression;
  createLogger(options: LoggerOptions): Logger;
}
