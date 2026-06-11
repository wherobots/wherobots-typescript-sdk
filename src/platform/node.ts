import zlib from "zlib";
import { promisify } from "util";
import WsWebSocket from "ws";
import pino from "pino";
import pinoPretty from "pino-pretty";
import { DataCompression } from "../constants";
import {
  AuthCredentials,
  Logger,
  LoggerOptions,
  Platform,
  SocketApiSubset,
} from "./types";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../version";

const brotliDecompress = promisify(zlib.brotliDecompress);
const gunzip = promisify(zlib.gunzip);

const authHeaders = (auth: AuthCredentials): Record<string, string> => {
  if (auth.token) {
    return { Authorization: `Bearer ${auth.token}` };
  }
  if (auth.apiKey) {
    return { "X-API-Key": auth.apiKey };
  }
  return {};
};

const openSocket = (url: string, auth: AuthCredentials): SocketApiSubset => {
  // `ws` provides send/close/add+removeEventListener but types its event
  // objects (and `send`'s Blob handling) slightly differently from the DOM, so
  // a structural assignment isn't possible. The cast targets the narrow
  // SocketApiSubset — which names exactly the surface the SDK uses — rather
  // than the full DOM WebSocket, so it stays auditable.
  return new WsWebSocket(url, {
    headers: authHeaders(auth),
    perMessageDeflate: false,
  }) as unknown as SocketApiSubset;
};

const decompress = async (
  payload: Uint8Array,
  compression: DataCompression,
): Promise<Uint8Array> => {
  switch (compression) {
    // Node's zlib returns a Buffer, which is a Uint8Array at runtime; the cast
    // bridges the stricter typed-array generics in recent TypeScript.
    case DataCompression.BROTLI:
      return (await brotliDecompress(payload)) as unknown as Uint8Array;
    case DataCompression.GZIP:
      return (await gunzip(payload)) as unknown as Uint8Array;
    case DataCompression.NONE:
      return payload;
    default:
      throw new Error(`Unsupported compression: ${compression}`);
  }
};

const wrapPino = (logger: pino.Logger): Logger => ({
  info: (msg) => logger.info(msg),
  debug: (msg) => logger.debug(msg as object),
  warn: (msg) => logger.warn(msg),
  error: (msg) => logger.error(msg),
  child: (context) => wrapPino(logger.child(context)),
});

const createLogger = (options: LoggerOptions): Logger =>
  wrapPino(
    pino(
      {
        name: options.name,
        level: options.debug ? "debug" : "info",
        enabled: options.enabled,
      },
      pinoPretty(),
    ),
  );

export const platform: Platform = {
  openSocket,
  decompress,
  userAgent: () =>
    `${PACKAGE_NAME}/${PACKAGE_VERSION} os/${process.platform};${process.arch} node/${process.version}`,
  defaultCompression: DataCompression.BROTLI,
  createLogger,
};
