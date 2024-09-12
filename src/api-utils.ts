import zlib from "zlib";
import z, { ZodRawShape } from "zod";
import { SessionReponse } from "./schemas";
import { DataCompression, ResultsFormat, SessionStatus } from "./constants";
import logger from "./logger";
import { tableFromIPC, TypeMap } from "apache-arrow";

export const parseResponse = async <T extends z.ZodObject<ZodRawShape>>(
  res: Response,
  schema: T,
): Promise<z.infer<T>> => {
  if (!res.ok) {
    logger
      .child({ status: res.status, url: res.url })
      .error(`Request failed: ${res.statusText}`);
    throw new Error(`Request failed: ${res.statusText}`);
  }
  const parseResult = schema.safeParse(await res.clone().json());
  if (!parseResult.success) {
    logger
      .child({ url: res.url, message: parseResult.error.message })
      .error("Invalid API response");
    logger.debug(parseResult.error);
    throw new Error("Invalid API response");
  }
  return parseResult.data;
};

export const isSessionInFinalState = (session: SessionReponse): boolean =>
  ![
    SessionStatus.PENDING,
    SessionStatus.PREPARING,
    SessionStatus.REQUESTED,
    SessionStatus.DEPLOYING,
    SessionStatus.DEPLOYED,
    SessionStatus.INITIALIZING,
  ].includes(session.status);

// choose a random number between 50% and 100% of the target delay
const jitter = (delay: number) => delay / 2 + (delay / 2) * Math.random();

// helper function to define the retry delay (in milliseconds)
// as a function of how many attempts have been made
export const backoffRetry = (attempts: number) => {
  if (attempts <= 1) {
    return jitter(1000);
  }
  if (attempts === 2) {
    return jitter(2000);
  }
  return jitter(5000);
};

export const toWsUrl = (url: string) => {
  if (url.startsWith("https:")) {
    return url.replace("https:", "wss:");
  }
  if (url.startsWith("http:")) {
    return url.replace("http:", "ws:");
  }
  return `wss:${url}`;
};

export const decompressPayload = async (
  payload: Buffer,
  compression: DataCompression,
) => {
  switch (compression) {
    case DataCompression.BROTLI:
      return new Promise<Buffer>((resolve, reject) => {
        zlib.brotliDecompress(payload, (err, result) => {
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        });
      });
    default:
      throw new Error(`Unsupported compression: ${compression}`);
  }
};

export const decodeResults = <Schema extends TypeMap>(
  results: Buffer,
  encoding: ResultsFormat,
) => {
  switch (encoding) {
    case ResultsFormat.ARROW:
      return tableFromIPC<Schema>(results);
    default:
      throw new Error(`Unsupported encoding: ${encoding}`);
  }
};

// we can use AbortSignal.any() once we don't support Node 18
export const combineAbortSignals = (
  ...signals: (AbortSignal | undefined)[]
): AbortSignal => {
  const controller = new AbortController();
  signals.forEach((signal) => {
    if (signal) {
      if (signal.aborted) {
        controller.abort(signal.reason);
        return;
      }
      signal.addEventListener("abort", () => controller.abort(signal.reason));
    }
  });
  return controller.signal;
};
