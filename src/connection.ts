import { decodeAllSync } from "cbor";
import fetchBuilder from "fetch-retry";
import * as uuid from "uuid";
import WebSocket from "ws";
import logger, { sessionContextLogger } from "./logger";
import {
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
  backoffRetry,
  decodeResults,
  decompressPayload,
  isSessionInFinalState,
  parseResponse,
  toWsUrl,
} from "./api-utils";
import z from "zod";
import { Table, TypeMap } from "apache-arrow";

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
};

const API_URL =
  process.env["WHEROBOTS_API_URL"] || "https://api.cloud.wherobots.com";

const PROTOCOL_VERSION = "1.0.0";

export class Connection {
  public static async connect(
    options: ConnectionOptions,
    testHarness?: ConnectionTestHarness,
  ) {
    const connection = new Connection(options, testHarness);
    await connection.establishSession();
    return connection;
  }

  public static async connectDirect(wsUrl: string, options: ConnectionOptions) {
    const connection = new Connection(options);
    await connection.connectToWebSocket(wsUrl);
    return connection;
  }

  private options: ConnectionOptionsNormalized;
  private fetch: ReturnType<typeof fetchBuilder<typeof fetch>>;
  private headers: Record<string, string>;
  private WebSocket: ConnectionTestHarness["WebSocket"];
  private ws: WebSocketApiSubset | null = null;
  private wsListeners: {
    name: keyof WebSocket.WebSocketEventMap;
    // for purposes of tracking and automatically cleaning up listeners,
    // we don't care about the event type argument to the listener
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listener: (e: any) => void | never;
  }[] = [];

  constructor(options: ConnectionOptions, testHarness?: ConnectionTestHarness) {
    this.options = ConnectionOptionsSchemaNormalized.parse(options);
    this.headers = {
      "Content-Type": "application/json",
      "X-API-Key": this.options.apiKey,
    };
    this.fetch = fetchBuilder(testHarness?.fetch || fetch);
    this.WebSocket = testHarness?.WebSocket || WebSocket;
    const { apiKey, ...optionsToLog } = this.options;
    logger.child(optionsToLog).debug("Creating connection");
  }

  private async establishSession() {
    const createdSession = await this.fetch(
      `${API_URL}/sql/session?region=${encodeURIComponent(this.options.region)}`,
      {
        method: "POST",
        body: JSON.stringify({
          runtimeId: this.options.runtime,
        }),
        headers: this.headers,
      },
    ).then((res) => parseResponse(res, SessionResponseSchema));
    sessionContextLogger(createdSession).debug("Session created");

    const establishedSession = await this.fetch(
      `${API_URL}/sql/session/${createdSession.id}`,
      {
        headers: this.headers,
        retryDelay: backoffRetry,
        retryOn: async (_, error, res) => {
          if (!error && res) {
            const session = await parseResponse(res, SessionResponseSchema);
            sessionContextLogger(session).debug("Checked session state");
            return !isSessionInFinalState(session);
          }
          return false;
        },
      },
    ).then((res) => parseResponse(res, ReadySessionResponseSchema));

    logger
      .child({ url: establishedSession.appMeta?.url })
      .debug("Session established");

    const wsUrl = `${toWsUrl(establishedSession.appMeta.url)}`;
    await this.connectToWebSocket(wsUrl);
  }

  private async connectToWebSocket(wsUrl: string) {
    const urlWithProtocol = `${wsUrl}/${PROTOCOL_VERSION}`;
    logger
      .child({ wsUrl: urlWithProtocol })
      .debug("Opening WebSocket connection");
    this.ws = new this.WebSocket(urlWithProtocol, {
      headers: { "X-API-Key": this.options.apiKey },
      perMessageDeflate: false,
    });
    this.addWsListener("error", this.onWsError);
    this.addWsListener("close", this.onWsClose);

    await new Promise((resolve) => {
      this.addWsListener("open", resolve, { once: true });
    });
    logger.child({ wsUrl }).debug("WebSocket connection is open");
  }

  public async execute<Schema extends TypeMap = TypeMap>(
    statement: string,
  ): Promise<Table<Schema>> {
    if (!this.ws) {
      throw new Error("WebSocket is not open");
    }
    const executionId = uuid.v4();
    const executionSuccessPromise = this.waitForMessage(
      executionId,
      StateUpdatedEventSchema,
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
  ): Promise<z.infer<T>> {
    return new Promise<z.infer<T>>((resolve) => {
      const handleMessage = (e: WebSocket.MessageEvent) => {
        try {
          const { success: isError, data: errorEvent } =
            ErrorEventSchema.safeParse(e.data);
          if (isError) {
            logger.child(errorEvent).error("Error event received");
            cleanup();
            throw new Error("Error event received");
          }
          let toParse: unknown;
          if (typeof e.data === "string") {
            toParse = JSON.parse(e.data);
          } else if (Array.isArray(e.data)) {
            toParse = decodeAllSync(Buffer.concat(e.data))[0];
          } else {
            const res = decodeAllSync(e.data);
            toParse = res[0];
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
    throw new Error("Web Socket error");
  }

  private onWsClose(e: WebSocket.CloseEvent) {
    logger
      .child({ wasClean: e, code: e.code, reason: e.code })
      .error("Web Socket closed unexpectedly");
    this.close();
    throw new Error("Web Socket closed unexpectedly");
  }

  public close(): void {
    logger.debug("Closing connection");
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
