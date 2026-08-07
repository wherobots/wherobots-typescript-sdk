import { DataCompression } from "../constants";
import {
  AuthCredentials,
  Logger,
  LoggerOptions,
  Platform,
  SocketApiSubset,
} from "./types";

// In the browser the native WebSocket cannot set request headers, so auth on
// the upgrade uses one of the two header-free channels the edge (goproxy)
// accepts:
//   - a bearer/session token via the ambient `wherobotsToken` cookie (sent
//     automatically because the page origin and the session host share the
//     registrable domain), or
//   - an API key via the `?token=` query param, which goproxy validates as an
//     X-API-Key. This requires the EnableTokenQueryParamGoproxy flag, and the
//     key is visible in the URL (and thus proxy/access logs), so prefer a
//     short-lived token + cookie when possible.
const openSocket = (url: string, auth: AuthCredentials): SocketApiSubset => {
  let socketUrl = url;
  if (auth.apiKey) {
    const separator = socketUrl.includes("?") ? "&" : "?";
    socketUrl += `${separator}token=${encodeURIComponent(auth.apiKey)}`;
  }
  const ws = new WebSocket(socketUrl);
  ws.binaryType = "arraybuffer";
  return ws;
};

const gunzipStream = async (payload: Uint8Array): Promise<Uint8Array> => {
  // The cast is required: TS's BlobPart wants Uint8Array<ArrayBuffer>, but our
  // payloads are the wider Uint8Array<ArrayBufferLike>. Safe at runtime.
  const stream = new Blob([payload as unknown as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const decompress = async (
  payload: Uint8Array,
  compression: DataCompression,
): Promise<Uint8Array> => {
  switch (compression) {
    case DataCompression.GZIP:
      return gunzipStream(payload);
    case DataCompression.NONE:
      return payload;
    case DataCompression.BROTLI:
      throw new Error(
        "Brotli decompression is not supported in the browser. Request `gzip` or `none` compression instead.",
      );
    default:
      throw new Error(`Unsupported compression: ${compression}`);
  }
};

// A minimal console-backed logger so the browser bundle pulls in neither pino
// nor pino-pretty. Context objects accumulate across `child` calls.
const consoleLogger = (
  options: LoggerOptions,
  context: object = {},
): Logger => {
  const enabled = options.enabled;
  const log =
    (level: "info" | "debug" | "warn" | "error") => (msg: string | object) => {
      if (!enabled) return;
      if (level === "debug" && !options.debug) return;
      const prefix = `[${options.name}]`;
      if (typeof msg === "string") {
        console[level](prefix, msg, context);
      } else {
        console[level](prefix, { ...context, ...msg });
      }
    };
  return {
    info: log("info"),
    debug: log("debug"),
    warn: log("warn"),
    error: log("error"),
    child: (childContext) =>
      consoleLogger(options, { ...context, ...childContext }),
  };
};

export const platform: Platform = {
  openSocket,
  decompress,
  // Browsers drop a JS-set User-Agent; the SDK identifies itself via the
  // X-Wherobots-Client header instead (set by the connection on both platforms).
  userAgent: () => undefined,
  clientPlatform: "browser",
  defaultCompression: DataCompression.GZIP,
  createLogger: (options) => consoleLogger(options),
};
