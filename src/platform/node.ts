import zlib from "zlib";
import fs from "fs";
import { readFile } from "fs/promises";
import { Readable } from "stream";
import { promisify } from "util";
import WsWebSocket from "ws";
import pino from "pino";
import pinoPretty from "pino-pretty";
import { DataCompression } from "../constants";
import {
  AuthCredentials,
  DownloadResponse,
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

const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

// Read the API's redirect ourselves and fetch the signed link as a fresh
// request with no headers at all, so no Wherobots credential reaches storage.
const fetchDownload = async (
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
): Promise<DownloadResponse> => {
  const apiResponse = await fetchImpl(url, { headers, redirect: "manual" });
  const location = apiResponse.headers.get("location");
  if (!REDIRECT_STATUSES.includes(apiResponse.status) || !location) {
    return { response: apiResponse, fromStorage: false };
  }
  const signedUrl = new URL(location, url).toString();
  const response = await fetchImpl(signedUrl, { redirect: "follow" });
  return { response, fromStorage: true };
};

const saveToFile = async (
  body: ReadableStream<Uint8Array>,
  path: string,
): Promise<void> => {
  const out = fs.createWriteStream(path);
  const source = Readable.fromWeb(
    body as Parameters<typeof Readable.fromWeb>[0],
  );
  await new Promise<void>((resolve, reject) => {
    source.on("error", (err) => {
      out.destroy();
      reject(err);
    });
    out.on("error", reject);
    out.on("finish", () => resolve());
    source.pipe(out);
  });
};

// A file-backed Blob carries its size, so the signed PUT gets a
// Content-Length (storage refuses chunked uploads). Node 18 lacks openAsBlob.
const openLocalFile = async (path: string): Promise<Blob> => {
  const openAsBlob = (
    fs as unknown as { openAsBlob?: (p: string) => Promise<Blob> }
  ).openAsBlob;
  if (openAsBlob) {
    return openAsBlob(path);
  }
  return new Blob([await readFile(path)]);
};

export const platform: Platform = {
  fetchDownload,
  saveToFile,
  openLocalFile,
  openSocket,
  decompress,
  userAgent: () =>
    `${PACKAGE_NAME}/${PACKAGE_VERSION} os/${process.platform};${process.arch} node/${process.version}`,
  clientPlatform: process.platform,
  defaultCompression: DataCompression.BROTLI,
  createLogger,
};
