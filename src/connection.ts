import fetchBuilder from "fetch-retry";
import logger, { sessionContextLogger } from "./logger";
import {
  ConnectionOptions,
  ConnectionOptionsNormalized,
  ConnectionOptionsSchemaNormalized,
  SessionResponseSchema,
} from "./schemas";
import {
  backoffRetry,
  isSessionInFinalState,
  parseResponse,
} from "./api-utils";

// will be used to mock out the fetch (and later WebSocket) API
// in a unit testing environment
type ConnectionTestHarness = {
  fetch: typeof fetch;
};

export class Connection {
  private options: ConnectionOptionsNormalized;
  private fetch: ReturnType<typeof fetchBuilder<typeof fetch>>;
  private headers: Record<string, string>;

  constructor(options: ConnectionOptions, testHarness?: ConnectionTestHarness) {
    this.options = ConnectionOptionsSchemaNormalized.parse(options);
    this.headers = {
      "Content-Type": "application/json",
      "X-API-Key": this.options.apiKey,
    };
    this.fetch = fetchBuilder(testHarness?.fetch || fetch);
    const { apiKey, ...optionsToLog } = this.options;
    logger.child(optionsToLog).debug("Creating connection");
    this.establishSession();
  }

  public close(): void {
    logger.debug("Closing connection");
  }

  public [Symbol.dispose](): void {
    this.close();
  }

  private async establishSession() {
    const createdSession = await this.fetch(
      `https://api.cloud.wherobots.com/sql/session?region=${encodeURIComponent(this.options.region)}`,
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
      `https://api.cloud.wherobots.com/sql/session/${createdSession.id}`,
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
    ).then((res) => parseResponse(res, SessionResponseSchema));
    logger
      .child({ url: establishedSession.appMeta?.url })
      .debug("Session established");
  }
}
