import { decodeFirstSync } from "cbor";
import semver from "semver";
import * as uuid from "uuid";
import WebSocket from "ws";
import logger, { sessionContextLogger } from "./logger";
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
  decompressPayload,
  isSessionInFinalState,
  NUM_RESLIENCY_RETRIES,
  parseResponse,
  shouldRetryForResiliency,
  toWsUrl,
} from "./api-utils";
import z from "zod";
import { Table, TypeMap } from "apache-arrow";
import { MIN_PROTOCOL_VERSION_FOR_CANCEL } from "./constants";

// used to mock out the fetch and WebSocket APIs
// in a unit testing environment
type WebSocketApiSubset = Pick<
  WebSocket,
  "send" | "close" | "addEventListener" | "removeEventListener"
>;
type ConnectionTestHarness = {
  fetch: typeof fetch;
  WebSocket: {
    new (url: string, options?: WebSocket.ClientOptions): WebSocketApiSubset;
  };
  protocolVersion?: string | undefined;
};

const API_URL =
  process.env["WHEROBOTS_API_URL"] || "https://api.cloud.wherobots.com";

const PROTOCOL_VERSION = "1.0.0";

const API_REQUEST_TIMEOUT = 10e3;

type ExecuteOptions = {
  signal?: AbortSignal;
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
  private WebSocket: ConnectionTestHarness["WebSocket"];
  private ws: WebSocketApiSubset | null = null;
  private protocolVersion: string;
  private wsListeners: {
    name: keyof WebSocket.WebSocketEventMap;
    // for purposes of tracking and automatically cleaning up listeners,
    // we don't care about the event type argument to the listener
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listener: (e: any) => void | never;
  }[] = [];
  private sessionAbortController = new AbortController();

  constructor(options: ConnectionOptions, testHarness?: ConnectionTestHarness) {
    this.options = ConnectionOptionsSchemaNormalized.parse({
      apiKey: process.env["WHEROBOTS_API_KEY"],
      ...options,
    });
    if (!this.options.apiKey) {
      throw new Error(
        "API key is required. It can be passed as an option or set as the WHEROBOTS_API_KEY environment variable",
      );
    }
    this.fetchOptions = {
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.options.apiKey,
        "Cache-Control": "no-store",
      },
      signal: this.sessionAbortController.signal,
      // the types we're using don't recognize the `cache` option
      // even though it is a valid option for the fetch API
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      cache: "no-store",
    };
    this.fetch = testHarness?.fetch || fetch;
    this.WebSocket = testHarness?.WebSocket || WebSocket;
    this.protocolVersion = testHarness?.protocolVersion || PROTOCOL_VERSION;
    const { apiKey, ...optionsToLog } = this.options;
    logger.child(optionsToLog).debug("Creating connection");
  }

  private async establishSession() {
    const createdSession = await asyncOperationWithRetry(
      (signal) =>
        this.fetch(
          `${API_URL}/sql/session?region=${encodeURIComponent(this.options.region)}`,
          {
            method: "POST",
            body: JSON.stringify({
              runtimeId: this.options.runtime,
            }),
            ...this.fetchOptions,
            signal: combineAbortSignals(signal, this.fetchOptions.signal),
          },
        ),
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
        this.fetch(`${API_URL}/sql/session/${createdSession.id}`, {
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
  // returning a Promise that either resolves to a WebSocket instance
  // if the connection is opened succesfully, or rejects if the connection
  // fails, is closed remotely, or is aborted due to a timeout
  private openWebSocket(
    url: string,
    signal: AbortSignal,
  ): Promise<WebSocketApiSubset> {
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", (e) => {
        reject(new Error(e.type));
        cleanup(true);
      });
      signal.throwIfAborted();
      const onSocketOpen = () => {
        cleanup();
        resolve(ws);
      };
      const onSocketFail = (e: WebSocket.ErrorEvent | WebSocket.CloseEvent) => {
        cleanup(true);
        reject(new Error(e.type));
      };
      const cleanup = (close?: boolean) => {
        ws.removeEventListener("open", onSocketOpen);
        ws.removeEventListener("error", onSocketFail);
        ws.removeEventListener("close", onSocketFail);
        if (close) {
          ws.close();
        }
      };
      const ws = new this.WebSocket(url, {
        headers: { "X-API-Key": this.options.apiKey },
        perMessageDeflate: false,
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
    };
    this.ws.send(JSON.stringify(retrieveEvent));
    logger
      .child({ executionId })
      .debug("Waiting for execution result to succeed");
    const results = await resultsPromise;

    const decompressed = await decompressPayload(
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
        if (semver.gte(this.protocolVersion, MIN_PROTOCOL_VERSION_FOR_CANCEL)) {
          logger.child({ executionId }).debug("Sending cancel event");
          const cancelEvent: CancelExecutionEvent = {
            kind: "cancel",
            execution_id: executionId,
          };
          this.ws?.send(JSON.stringify(cancelEvent));
        }
      };
      abortSignal.addEventListener("abort", () => {
        sendCancellation();
        cleanup();
        reject(new Error("Execution aborted"));
      });
      if (abortSignal.aborted) {
        sendCancellation();
        reject(new Error("Execution aborted"));
        return;
      }

      const handleMessage = (e: WebSocket.MessageEvent) => {
        try {
          if (typeof e.data === "string") {
            const { success: isError, data: errorEvent } =
              ErrorEventSchema.safeParse(JSON.parse(e.data));
            if (isError) {
              logger.child(errorEvent).error("Error event received");
              cleanup();
              reject(new Error("Error event received"));
            }
          }
          let toParse: unknown;
          if (typeof e.data === "string") {
            toParse = JSON.parse(e.data);
          } else if (Array.isArray(e.data)) {
            toParse = decodeFirstSync(Buffer.concat(e.data));
          } else {
            toParse = decodeFirstSync(e.data);
          }
          const data = schema.parse(toParse);
          if (data["execution_id"] === executionId) {
            cleanup();
            resolve(data);
          }
        } catch (err) {
          // ignore the message if it doesn't match the schema
          // note that this could be because "status" is "failed",
          // but this is ok to ignore because a dedicated error event
          // will also be sent
        }
      };
      const cleanup = this.addWsListener("message", handleMessage);
    });
  }

  private addWsListener<E extends keyof WebSocket.WebSocketEventMap>(
    name: E,
    listener: (e: WebSocket.WebSocketEventMap[E]) => void,
    options?: WebSocket.EventListenerOptions,
  ) {
    if (!this.ws) {
      throw new Error("WebSocket is not open");
    }
    const boundListener = listener.bind(this);
    this.wsListeners.push({ name, listener: boundListener });
    this.ws.addEventListener(name, boundListener, options);
    return () => this.ws?.removeEventListener(name, boundListener);
  }

  private onWsError(e: WebSocket.ErrorEvent) {
    logger.child({ message: e.message }).error("Web Socket error");
    this.close();
  }

  private onWsClose(e: WebSocket.CloseEvent) {
    logger
      .child({ wasClean: e, code: e.code, reason: e.code })
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
