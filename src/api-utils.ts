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

type RetryOptions<T> = {
  timeout: number;
  retryOn: (
    attempts: number,
    error: Error | null,
    result: T | null,
  ) => boolean | Promise<boolean>;
  retryDelay: (attempts: number) => number;
};

/*
 * helper function to perform an async operation where the caller can
 * specify the retry and timeout semantics via an options API.
 *
 * in order for timeouts to be handled correctly, the contract with the caller is
 * that the operation function must take an abort signal as an argument and
 * must respect the signal by aborting the operation when the signal is aborted.
 *
 * in the case of a timeout, the `retryOn` function will be called with an error
 * with the name "TimeoutError", which can be used to define how timeouts are retried.
 */
export const asyncOperationWithRetry = async <T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: RetryOptions<T>,
): Promise<T> => {
  const performAttempt = async (): Promise<[Error | null, T | null]> => {
    try {
      const timeoutSignal = AbortSignal.timeout(options.timeout);
      const r = await operation(timeoutSignal);
      return [null, r];
    } catch (e) {
      return [e as Error, null];
    }
  };
  let attempts = 0;
  let [error, result] = await performAttempt();
  while (await options.retryOn(attempts, error, result)) {
    const delay = options.retryDelay(attempts);
    await new Promise((resolve) => setTimeout(resolve, delay));
    attempts += 1;
    [error, result] = await performAttempt();
  }
  if (error) {
    return Promise.reject(error);
  }
  return Promise.resolve(result as T);
};

export const RETRYABLE_HTTP_STATUS_CODES = [502, 503];
export const NUM_RESLIENCY_RETRIES = 3;
export const shouldRetryForResiliency = (
  attempt: number,
  error: Error | null,
  result: { status: number } | null,
) => {
  if (attempt >= NUM_RESLIENCY_RETRIES) {
    return false;
  }
  if (result && RETRYABLE_HTTP_STATUS_CODES.includes(result.status)) {
    logger
      .child({ status: result.status, attempt })
      .debug("Retrying due to HTTP status");
    return true;
  }
  if (error && error.name === "TimeoutError") {
    logger.child({ attempt }).debug("Retrying due to timeout");
    return true;
  }
  return false;
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
  ...signals: (AbortSignal | null | undefined)[]
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
