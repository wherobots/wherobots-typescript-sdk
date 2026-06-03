import zlib from "zlib";
import { promisify } from "util";
import WebSocket from "ws";
import pino from "pino";
import pinoPretty from "pino-pretty";
import { DataCompression } from "../constants";
import { adaptSocket } from "./socketAdapter";
import {
  AuthCredentials,
  Logger,
  LoggerOptions,
  Platform,
  SocketLike,
} from "./types";
import pkg from "../../package.json";

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

const openSocket = (url: string, auth: AuthCredentials): SocketLike => {
  const ws = new WebSocket(url, {
    headers: authHeaders(auth),
    perMessageDeflate: false,
  });
  return adaptSocket(ws as unknown as Parameters<typeof adaptSocket>[0]);
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
  getEnv: (name) => process.env[name],
  userAgent: () =>
    `${pkg.name}/${pkg.version} os/${process.platform};${process.arch} node/${process.version}`,
  defaultCompression: DataCompression.BROTLI,
  createLogger,
};
