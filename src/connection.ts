import * as uuid from "uuid";
import { decode as decodeCbor } from "cbor-x";
import { Table, TypeMap } from "apache-arrow";
import z from "zod";
import { platform } from "@platform";
import logger, { sessionContextLogger } from "./logger";
import { getEnv } from "./platform/env";
import { OpenSocket, SocketApiSubset } from "./platform/types";
import { CLIENT_HEADER_NAME, clientHeaderValue } from "./clientHeader";
import { DataCompression } from "./constants";
import {
  CancelExecutionEvent,
  ConnectionOptions,
  ConnectionOptionsNormalized,
  ConnectionOptionsSchemaNormalized,
  ErrorEventSchema,
  EventWithExecutionIdSchema,
  ExecuteSQLEvent,
  ExecutionResultEventSchema,
  ReadySessionResponseSchema,
  RetrieveResultsEvent,
  SessionResponseSchema,
  StateUpdatedEventSchema,
} from "./schemas";
import {
  asyncOperationWithRetry,
  backoffRetry,
  combineAbortSignals,
  decodeResults,
  isSessionInFinalState,
  NUM_RESLIENCY_RETRIES,
  parseResponse,
  shouldRetryForResiliency,
  toWsUrl,
} from "./api-utils";

type ConnectionTestHarness = {
  fetch: typeof fetch;
  openSocket?: OpenSocket;
  protocolVersion?: string | undefined;
};

const DEFAULT_API_URL = "https://api.cloud.wherobots.com";
const PROTOCOL_VERSION = "1.0.0";
const API_REQUEST_TIMEOUT = 10e3;

type ExecuteOptions = {
  signal?: AbortSignal;
};

// Normalize a WebSocket message payload to a Uint8Array across platforms:
// Node `ws` delivers a Buffer or Buffer[]; a browser native socket with
// binaryType="arraybuffer" delivers an ArrayBuffer (Blob is handled defensively).
const toBytes = async (data: unknown): Promise<Uint8Array> => {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (Array.isArray(data)) {
    const total = data.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of data) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }
  throw new Error("Unsupported WebSocket message payload");
};

export class Connection {
  public static async connect(
    options: ConnectionOptions,
    testHarness?: ConnectionTestHarness,
  ) {
    const connection = new Connection(options, testHarness);
    logger.info(
      "Initializing SQL session. Please wait, this process may take a few moments...",
    );
    await connection.establishSession();
    return connection;
  }

  public static async connectDirect(wsUrl: string, options: ConnectionOptions) {
    const connection = new Connection(options);
    await connection.connectToWebSocket(wsUrl);
    return connection;
  }

  private options: ConnectionOptionsNormalized;
  private fetch: typeof fetch;
  private fetchOptions: RequestInit;
  private apiUrl: string;
  private compression: DataCompression;
  private openSocket: OpenSocket;
  private ws: SocketApiSubset | null = null;
  private protocolVersion: string;
  private wsListeners: {
    name: keyof WebSocketEventMap;
    // for purposes of tracking and automatically cleaning up listeners,
    // we don't care about the event type argument to the listener
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listener: (e: any) => void | never;
  }[] = [];
  private sessionAbortController = new AbortController();

  constructor(options: ConnectionOptions, testHarness?: ConnectionTestHarness) {
    // Apply the WHEROBOTS_API_KEY env fallback (Node only) only when the caller
    // supplied neither an explicit apiKey nor a token, so passing a token never
    // collides with an ambient API key.
    const merged: ConnectionOptions = { ...options };
    if (!merged.apiKey && !merged.token) {
      const envApiKey = getEnv("WHEROBOTS_API_KEY");
      if (envApiKey) {
        merged.apiKey = envApiKey;
      }
    }
    this.options = ConnectionOptionsSchemaNormalized.parse(merged);

    this.apiUrl =
      this.options.apiUrl || getEnv("WHEROBOTS_API_URL") || DEFAULT_API_URL;
    this.compression =
      this.options.dataCompression ?? platform.defaultCompression;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      // Identifies the SDK on both platforms; a custom header is used because
      // browsers drop a JS-set User-Agent. The richer User-Agent below is
      // added only where the runtime allows it (Node).
      [CLIENT_HEADER_NAME]: clientHeaderValue(this.options.clientChain),
    };
    if (this.options.token) {
      headers["Authorization"] = `Bearer ${this.options.token}`;
    } else if (this.options.apiKey) {
      headers["X-API-Key"] = this.options.apiKey;
    }
    const userAgent = platform.userAgent();
    if (userAgent) {
      headers["User-Agent"] = userAgent;
    }
    this.fetchOptions = {
      headers,
      signal: this.sessionAbortController.signal,
      // the types we're using don't recognize the `cache` option
      // even though it is a valid option for the fetch API
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      cache: "no-store",
    };
    // The global fetch must be invoked with `this` bound to the global object
    // (the browser throws "Illegal invocation" otherwise); a harness-supplied
    // fetch is used as-is.
    this.fetch = testHarness?.fetch ?? fetch.bind(globalThis);
    this.openSocket = testHarness?.openSocket || platform.openSocket;
    this.protocolVersion = testHarness?.protocolVersion || PROTOCOL_VERSION;
    const { apiKey, token, ...optionsToLog } = this.options;
    logger.child(optionsToLog).debug("Creating connection");
  }

  private async establishSession() {
    // Only send `region` when set; an omitted region lets the API apply the
    // organization's configured default. `runtimeId` is likewise dropped from
    // the body below when undefined (JSON.stringify omits undefined values).
    const sessionParams = new URLSearchParams();
    if (this.options.region) {
      sessionParams.set("region", this.options.region);
    }
    sessionParams.set("force_new", String(this.options.forceNew));
    const createdSession = await asyncOperationWithRetry(
      (signal) =>
        this.fetch(`${this.apiUrl}/sql/session?${sessionParams.toString()}`, {
          method: "POST",
          body: JSON.stringify({
            runtimeId: this.options.runtime,
            version: this.options.version,
            sessionType: this.options.sessionType,
            shutdownAfterInactiveSeconds:
              this.options.shutdownAfterInactiveSeconds,
          }),
          ...this.fetchOptions,
          signal: combineAbortSignals(signal, this.fetchOptions.signal),
        }),
      {
        retryOn: shouldRetryForResiliency,
        retryDelay: backoffRetry,
        timeout: API_REQUEST_TIMEOUT,
      },
    ).then((res) => parseResponse(res, SessionResponseSchema));
    sessionContextLogger(createdSession).debug("Session created");

    // a custom counter that is only incremented when a request is retried
    // due to an error, as opposed to a successful request that is retried
    // because the session is not ready yet
    let numFailedAttempts = 0;
    const establishedSession = await asyncOperationWithRetry(
      (signal) =>
        this.fetch(`${this.apiUrl}/sql/session/${createdSession.id}`, {
          ...this.fetchOptions,
          signal: combineAbortSignals(signal, this.fetchOptions.signal),
        }),
      {
        retryDelay: backoffRetry,
        retryOn: async (_, error, res) => {
          if (shouldRetryForResiliency(numFailedAttempts, error, res)) {
            numFailedAttempts++;
            return true;
          }
          if (!error && res) {
            const session = await parseResponse(res, SessionResponseSchema);
            sessionContextLogger(session).debug("Checked session state");
            return !isSessionInFinalState(session);
          }
          return false;
        },
        timeout: API_REQUEST_TIMEOUT,
      },
    ).then((res) => parseResponse(res, ReadySessionResponseSchema));

    logger
      .child({ url: establishedSession.appMeta?.url })
      .debug("Session established");

    const wsUrl = `${toWsUrl(establishedSession.appMeta.url)}`;
    await this.connectToWebSocket(wsUrl);
  }

  private async connectToWebSocket(wsUrl: string) {
    const urlWithProtocol = `${wsUrl}/${this.protocolVersion}`;
    logger
      .child({ wsUrl: urlWithProtocol })
      .debug("Opening WebSocket connection");

    this.ws = await asyncOperationWithRetry(
      (signal) =>
        this.openWebSocket(
          urlWithProtocol,
          combineAbortSignals(signal, this.sessionAbortController.signal),
        ),
      {
        retryOn: (attempt, error) => {
          if (error && attempt < NUM_RESLIENCY_RETRIES) {
            logger
              .child({ attempt, error: error.message })
              .warn("Retrying WebSocket connection");
            return true;
          }
          return false;
        },
        retryDelay: backoffRetry,
        timeout: API_REQUEST_TIMEOUT,
      },
    );
    this.addWsListener("error", this.onWsError);
    this.addWsListener("close", this.onWsClose);

    logger
      .child({ wsUrl: urlWithProtocol })
      .debug("WebSocket connection is open");
  }

  // helper method to attempt to open a WebSocket connection,
  // returning a Promise that either resolves to a socket instance
  // if the connection is opened succesfully, or rejects if the connection
  // fails, is closed remotely, or is aborted due to a timeout
  private openWebSocket(
    url: string,
    signal: AbortSignal,
  ): Promise<SocketApiSubset> {
    return new Promise((resolve, reject) => {
      const onAbort = (e: Event) => {
        reject(new Error(e.type));
        cleanup(true);
      };
      signal.addEventListener("abort", onAbort);
      signal.throwIfAborted();
      const onSocketOpen = () => {
        cleanup();
        resolve(ws);
      };
      const onSocketFail = (e: Event) => {
        cleanup(true);
        reject(new Error(e.type));
      };
      const cleanup = (close?: boolean) => {
        signal.removeEventListener("abort", onAbort);
        ws.removeEventListener("open", onSocketOpen);
        ws.removeEventListener("error", onSocketFail);
        ws.removeEventListener("close", onSocketFail);
        if (close) {
          ws.close();
        }
      };
      const ws = this.openSocket(url, {
        token: this.options.token,
        apiKey: this.options.apiKey,
      });
      ws.addEventListener("open", onSocketOpen, { once: true });
      ws.addEventListener("error", onSocketFail, { once: true });
      ws.addEventListener("close", onSocketFail, { once: true });
    });
  }

  public async execute<Schema extends TypeMap = TypeMap>(
    statement: string,
    options: ExecuteOptions = {},
  ): Promise<Table<Schema>> {
    if (!this.ws) {
      throw new Error("WebSocket is not open");
    }
    const executionId = uuid.v4();
    const executionAbortSignal = combineAbortSignals(
      this.sessionAbortController.signal,
      options.signal,
    );
    const executionSuccessPromise = this.waitForMessage(
      executionId,
      StateUpdatedEventSchema,
      executionAbortSignal,
    );
    const executeEvent: ExecuteSQLEvent = {
      kind: "execute_sql",
      execution_id: executionId,
      statement,
    };
    this.ws.send(JSON.stringify(executeEvent));
    logger
      .child({ executionId })
      .debug("Waiting for execution to be successful");
    await executionSuccessPromise;

    const resultsPromise = this.waitForMessage(
      executionId,
      ExecutionResultEventSchema,
      executionAbortSignal,
    );
    const retrieveEvent: RetrieveResultsEvent = {
      kind: "retrieve_results",
      execution_id: executionId,
      geometry: this.options.geometryRepresentation,
      compression: this.compression,
    };
    this.ws.send(JSON.stringify(retrieveEvent));
    logger
      .child({ executionId })
      .debug("Waiting for execution result to succeed");
    const results = await resultsPromise;

    const decompressed = await platform.decompress(
      results.results.result_bytes,
      results.results.compression,
    );
    const decoded = decodeResults<Schema>(decompressed, results.results.format);
    return Promise.resolve(decoded);
  }

  private async waitForMessage<T extends typeof EventWithExecutionIdSchema>(
    executionId: string,
    schema: T,
    abortSignal: AbortSignal,
  ): Promise<z.infer<T>> {
    return new Promise<z.infer<T>>((resolve, reject) => {
      const sendCancellation = () => {
        logger.child({ executionId }).debug("Sending cancel event");
        const cancelEvent: CancelExecutionEvent = {
          kind: "cancel",
          execution_id: executionId,
        };
        this.ws?.send(JSON.stringify(cancelEvent));
      };
      const handleSignalAborted = () => {
        sendCancellation();
        cleanup();
        reject(new Error("Execution aborted"));
      };
      abortSignal.addEventListener("abort", handleSignalAborted);
      if (abortSignal.aborted) {
        sendCancellation();
        reject(new Error("Execution aborted"));
        return;
      }

      const handleMessage = async (e: MessageEvent) => {
        try {
          let toParse: unknown;
          if (typeof e.data === "string") {
            toParse = JSON.parse(e.data);
          } else {
            toParse = decodeCbor(await toBytes(e.data));
          }

          // Early check: only process messages that belong to this execution
          const { success: hasExecutionId, data: eventWithId } =
            EventWithExecutionIdSchema.safeParse(toParse);
          if (!hasExecutionId || eventWithId.execution_id !== executionId) {
            return; // Ignore messages for other executions
          }

          // Check if this is an error event
          const { success: isError, data: errorEvent } =
            ErrorEventSchema.safeParse(toParse);
          if (isError) {
            logger.child(errorEvent).error("Error event received");
            cleanup();
            abortSignal.removeEventListener("abort", handleSignalAborted);
            reject(new Error(errorEvent.message));
            return;
          }

          // Try to parse as the expected schema
          const data = schema.parse(toParse);
          cleanup();
          abortSignal.removeEventListener("abort", handleSignalAborted);
          resolve(data);
        } catch (err) {
          // A schema mismatch is expected and ignored: the message may be for a
          // different schema, or "status" may be "failed" (a dedicated error
          // event is also sent in that case). Anything else (e.g. a binary
          // decode failure in toBytes/decodeCbor) is unexpected, so surface it
          // at debug level rather than swallowing it entirely.
          if (!(err instanceof z.ZodError)) {
            logger
              .child({ executionId, error: (err as Error)?.message })
              .debug("Failed to handle WebSocket message");
          }
        }
      };
      const cleanup = this.addWsListener("message", handleMessage);
    });
  }

  private addWsListener<E extends keyof WebSocketEventMap>(
    name: E,
    listener: (e: WebSocketEventMap[E]) => void,
    options?: AddEventListenerOptions,
  ) {
    if (!this.ws) {
      throw new Error("WebSocket is not open");
    }
    const boundListener = listener.bind(this);
    this.wsListeners.push({ name, listener: boundListener });
    this.ws.addEventListener(name, boundListener, options);
    return () => this.ws?.removeEventListener(name, boundListener);
  }

  private onWsError(e: Event) {
    logger
      .child({ message: (e as ErrorEvent).message })
      .error("Web Socket error");
    this.close();
  }

  private onWsClose(e: CloseEvent) {
    logger
      .child({ code: e.code, reason: e.reason })
      .error("Web Socket closed unexpectedly");
    this.close();
  }

  public close(): void {
    logger.debug("Closing connection");
    this.sessionAbortController.abort();
    if (this.ws) {
      this.wsListeners.forEach((l) =>
        this.ws?.removeEventListener(l.name, l.listener),
      );
      this.ws.close();
    }
    this.ws = null;
    this.wsListeners = [];
  }

  public [Symbol.dispose](): void {
    this.close();
  }
}
