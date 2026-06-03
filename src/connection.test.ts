import { readFileSync } from "fs";
import { resolve } from "path";
import { expect, test, describe, vi, beforeEach } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import fetchMockBuilder, { FetchMock } from "vitest-fetch-mock";
import WebSocket from "ws";
import { Connection } from "./connection";
import { Runtime, SessionType } from "./constants";
import {
  SESSION_LIFECYCLE_RESPONSES,
  simulateImmediatelyReadySession,
  simulateSessionCreateInvalidResponse,
  simulateSessionCreateTimeout,
  simulateSessionCreateTransientNetworkError,
  simulateSessionCreateUnauthenticated,
  simulateSessionCreationLifecycle,
  simulateSessionPollInvalidResponse,
  simulateSessionPollTransientNetworkError,
  simulateSessionServiceError,
} from "./testing/mockSessionBehaviors";
import {
  createMockWebSocket,
  expectAllSocketListenersRemoved,
  getSentMessages,
  resetMockWebSocket,
  simulateImmediatelyOpenSocket,
  simulateSocketWithConnectionClosed,
  simulateSocketWithConnectionError,
  simulateSocketWithConnectionTimeout,
  simulateSocketWithMultipleExecutions,
  simulateSocketWithMultipleExecutionsOneError,
  simulateSocketWithSingleExecution,
  simulateSocketWithSingleExecutionError,
  simulateSocketWithSingleExecutionPaused,
  simulateSocketWithTransitentConnectionErrors,
  wasSocketClosed,
  mockWebSocketDefaultImplementation,
  simulateHandleOpen,
  simulateStateUpdateSuccess,
  simulateWebSocketEvent,
  simulateExecutionResult,
} from "./testing/mockSocketBehaviors";
import { NUM_RESLIENCY_RETRIES } from "./api-utils";
import { OpenSocket } from "./platform/types";

// unfortunately, AbortController.timeout functionality can't be mocked using
// vitest fake timers, so we have to replace it with an equivalent implementation
// that uses setTimeout
global.AbortSignal.timeout = (delay: number) => {
  const controller = new AbortController();
  setTimeout(
    () =>
      controller.abort(
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        new global.DOMException("The operation timed out.", "TimeoutError"),
      ),
    delay,
  );
  return controller.signal;
};

const showSchemasExpectedPayload = JSON.parse(
  readFileSync(resolve(__dirname, "./testing/payloads/showSchemas.json"), {
    encoding: "utf-8",
  }),
);
const showTablesExpectedPayload = JSON.parse(
  readFileSync(resolve(__dirname, "./testing/payloads/showTables.json"), {
    encoding: "utf-8",
  }),
);

const showSchemasPayloadBrotli = new Uint8Array(
  readFileSync(resolve(__dirname, "./testing/payloads/showSchemas.br")),
);

const fetchMock = fetchMockBuilder(vi);
const MockWebSocket = createMockWebSocket();

const testHarness = {
  fetch: fetchMock as unknown as typeof fetch,
  // The connection opens sockets through `openSocket`; route it to the mock
  // constructor so the existing simulate* helpers (which inspect the mock's
  // calls/results) keep working unchanged.
  openSocket: (() => MockWebSocket()) as unknown as OpenSocket,
};
const testApiKey = "12345678-1234-1234-1234-123456789ab";
const expectCorrectApiKey = () => {
  expect(fetchMock).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      headers: expect.objectContaining({
        "X-API-Key": testApiKey,
      }),
    }),
  );
};

const expectMatchingSessionCreateBody = (
  fetchMock: FetchMock,
  expectedBody: unknown,
) => {
  const createCall = fetchMock.mock.calls.find(
    (call) => call[1]?.method === "POST",
  );
  const body = JSON.parse(createCall?.[1]?.body as string);
  expect(body).toEqual(expect.objectContaining(expectedBody));
};

const createConnectionUnderTest = () =>
  Connection.connect(
    {
      apiKey: testApiKey,
      runtime: Runtime.TINY,
    },
    { ...testHarness },
  );

beforeEach(() => {
  fetchMock.mockReset();
  resetMockWebSocket(MockWebSocket);
  vi.useFakeTimers();
});

describe("Connection.connect, when passed connection options", () => {
  test("accepts valid arguments", async () => {
    simulateImmediatelyReadySession(fetchMock);
    simulateImmediatelyOpenSocket(MockWebSocket);
    const connection = createConnectionUnderTest();
    vi.runAllTimersAsync();
    await expect(connection).resolves.toBeInstanceOf(Connection);
    expectCorrectApiKey();
  });

  test("rejects if API key is missing", async () => {
    if (process.env["WHEROBOTS_API_KEY"]) {
      throw new Error(
        "this test is invalid if WHEROBOTS_API_KEY environment variable is set",
      );
    }
    const connection = Connection.connect(
      {
        runtime: Runtime.TINY,
      },
      testHarness,
    );
    vi.runAllTimersAsync();
    await expect(connection).rejects.toBeInstanceOf(Error);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("does not reject if API key is set via env variable", async () => {
    simulateImmediatelyReadySession(fetchMock);
    simulateImmediatelyOpenSocket(MockWebSocket);
    const previousApiKey = process.env["WHEROBOTS_API_KEY"];
    process.env["WHEROBOTS_API_KEY"] = testApiKey;
    try {
      const connection = Connection.connect(
        {
          runtime: Runtime.TINY,
        },
        testHarness,
      );
      vi.runAllTimersAsync();
      await expect(connection).resolves.toBeInstanceOf(Connection);
      expectCorrectApiKey();
    } finally {
      process.env["WHEROBOTS_API_KEY"] = previousApiKey;
    }
  });

  test("rejects if given invalid arguments", async () => {
    const connection = Connection.connect(
      {
        apiKey: testApiKey,
        // A non-string runtime is still invalid (region/runtime now accept
        // any string, but not arbitrary types).
        runtime: 123 as unknown as Runtime,
      },
      testHarness,
    );
    vi.runAllTimersAsync();
    await expect(connection).rejects.toBeInstanceOf(Error);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("passes raw region/runtime strings through (e.g. BYOC)", async () => {
    simulateImmediatelyReadySession(fetchMock);
    simulateImmediatelyOpenSocket(MockWebSocket);
    const connection = Connection.connect(
      {
        apiKey: testApiKey,
        runtime: "x-large",
        region: "byoc-acme-us-east-1",
      },
      { ...testHarness },
    );
    vi.runAllTimersAsync();
    await connection;
    const createCall = fetchMock.mock.calls.find(
      (call) => call[1]?.method === "POST",
    );
    expect(createCall?.[0]).toContain("region=byoc-acme-us-east-1");
    const body = JSON.parse(createCall?.[1]?.body as string);
    expect(body.runtimeId).toBe("x-large");
  });

  test("omits region and runtime when not provided", async () => {
    simulateImmediatelyReadySession(fetchMock);
    simulateImmediatelyOpenSocket(MockWebSocket);
    const connection = Connection.connect(
      {
        apiKey: testApiKey,
      },
      { ...testHarness },
    );
    vi.runAllTimersAsync();
    await connection;
    const createCall = fetchMock.mock.calls.find(
      (call) => call[1]?.method === "POST",
    );
    expect(createCall?.[0]).not.toContain("region=");
    const body = JSON.parse(createCall?.[1]?.body as string);
    expect(body.runtimeId).toBeUndefined();
  });

  test("defaults to 'single' session type", async () => {
    simulateImmediatelyReadySession(fetchMock);
    simulateImmediatelyOpenSocket(MockWebSocket);
    Connection.connect(
      {
        apiKey: testApiKey,
        runtime: Runtime.TINY,
      },
      testHarness,
    );
    vi.runAllTimersAsync();
    expectMatchingSessionCreateBody(fetchMock, {
      sessionType: "single",
    });
  });

  test("can be set to 'multi' session type", async () => {
    simulateImmediatelyReadySession(fetchMock);
    simulateImmediatelyOpenSocket(MockWebSocket);
    Connection.connect(
      {
        apiKey: testApiKey,
        runtime: Runtime.TINY,
        sessionType: SessionType.MULTI,
      },
      testHarness,
    );
    vi.runAllTimersAsync();
    expectMatchingSessionCreateBody(fetchMock, {
      sessionType: "multi",
    });
  });

  test("can be set with shutdownAfterInactiveSeconds", async () => {
    simulateImmediatelyReadySession(fetchMock);
    simulateImmediatelyOpenSocket(MockWebSocket);
    Connection.connect(
      {
        apiKey: testApiKey,
        runtime: Runtime.TINY,
        shutdownAfterInactiveSeconds: 3600,
      },
      testHarness,
    );
    vi.runAllTimersAsync();
    expectMatchingSessionCreateBody(fetchMock, {
      shutdownAfterInactiveSeconds: 3600,
    });
  });

  test("rejects if shutdownAfterInactiveSeconds is invalid", async () => {
    const connection = Connection.connect(
      {
        apiKey: testApiKey,
        runtime: Runtime.TINY,
        shutdownAfterInactiveSeconds: -100,
      },
      testHarness,
    );
    vi.runAllTimersAsync();
    await expect(connection).rejects.toBeInstanceOf(Error);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Connection.connect, when establishing SQL session", () => {
  test("polls until READY state is reached", async () => {
    simulateSessionCreationLifecycle(fetchMock);
    simulateImmediatelyOpenSocket(MockWebSocket);
    const connection = createConnectionUnderTest();
    vi.runAllTimersAsync();
    await expect(connection).resolves.toBeInstanceOf(Connection);
    expect(fetchMock).toHaveBeenCalledTimes(SESSION_LIFECYCLE_RESPONSES.length);
    expect(wasSocketClosed(MockWebSocket)).toEqual(false);
  });

  test("rejects if session create fails", async () => {
    simulateSessionCreateUnauthenticated(fetchMock);
    simulateImmediatelyOpenSocket(MockWebSocket);
    const connection = createConnectionUnderTest();
    await expect(connection).rejects.toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("rejects if session create has invalid response", async () => {
    simulateSessionCreateInvalidResponse(fetchMock);
    simulateImmediatelyOpenSocket(MockWebSocket);
    const connection = createConnectionUnderTest();
    await expect(connection).rejects.toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("retries if session create fails with a networ error", async () => {
    simulateSessionCreateTransientNetworkError(fetchMock, {
      numInitialFailures: NUM_RESLIENCY_RETRIES,
    });
    simulateImmediatelyOpenSocket(MockWebSocket);
    const connection = createConnectionUnderTest();
    vi.runAllTimersAsync();
    await expect(connection).resolves.toBeInstanceOf(Connection);
  });

  test("stops retrying if session create consistently fails with a networ error", async () => {
    simulateSessionCreateTransientNetworkError(fetchMock, {
      numInitialFailures: NUM_RESLIENCY_RETRIES + 1,
    });
    simulateImmediatelyOpenSocket(MockWebSocket);
    const connection = createConnectionUnderTest();
    vi.runAllTimersAsync();
    await expect(connection).rejects.toBeInstanceOf(Error);
  });

  test("retries if session create times out", async () => {
    simulateSessionCreateTimeout(fetchMock, {
      numTimeouts: NUM_RESLIENCY_RETRIES,
    });
    simulateImmediatelyOpenSocket(MockWebSocket);
    const connection = createConnectionUnderTest();
    vi.runAllTimersAsync();
    await expect(connection).resolves.toBeInstanceOf(Connection);
  });

  test("stops retrying if session create times out consistently", async () => {
    simulateSessionCreateTimeout(fetchMock, {
      numTimeouts: NUM_RESLIENCY_RETRIES + 1,
    });
    simulateImmediatelyOpenSocket(MockWebSocket);
    const connection = createConnectionUnderTest();
    vi.runAllTimersAsync();
    await expect(connection).rejects.toBeInstanceOf(Error);
  });

  test("rejects if session server returns error while polling", async () => {
    simulateSessionServiceError(fetchMock, { numInitialSuccesses: 2 });
    simulateImmediatelyOpenSocket(MockWebSocket);
    const connection = createConnectionUnderTest();
    await expect(connection).rejects.toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("rejects if session server returns invalid response while polling", async () => {
    simulateSessionPollInvalidResponse(fetchMock, { numInitialSuccesses: 2 });
    simulateImmediatelyOpenSocket(MockWebSocket);
    const connection = createConnectionUnderTest();
    await expect(connection).rejects.toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("retries if session polling fails with network error", async () => {
    simulateSessionPollTransientNetworkError(fetchMock, {
      numFailures: NUM_RESLIENCY_RETRIES,
    });
    simulateImmediatelyOpenSocket(MockWebSocket);
    const connection = createConnectionUnderTest();
    vi.runAllTimersAsync();
    await expect(connection).resolves.toBeInstanceOf(Connection);
  });

  test("stops retrying if session polling consistently fails with network error", async () => {
    simulateSessionPollTransientNetworkError(fetchMock, {
      numFailures: NUM_RESLIENCY_RETRIES + 1,
    });
    simulateImmediatelyOpenSocket(MockWebSocket);
    const connection = createConnectionUnderTest();
    vi.runAllTimersAsync();
    await expect(connection).rejects.toBeInstanceOf(Error);
  });

  test("removes all socket listeners when connection is closed", async () => {
    simulateImmediatelyReadySession(fetchMock);
    simulateImmediatelyOpenSocket(MockWebSocket);
    const connection = createConnectionUnderTest();
    vi.runAllTimersAsync();
    (await connection).close();
    expectAllSocketListenersRemoved(MockWebSocket);
  });

  test("retries if websocket connection fails", async () => {
    simulateImmediatelyReadySession(fetchMock);
    simulateSocketWithTransitentConnectionErrors(MockWebSocket, {
      numInitialFailures: NUM_RESLIENCY_RETRIES,
    });
    const connection = createConnectionUnderTest();
    vi.runAllTimersAsync();
    await expect(connection).resolves.toBeInstanceOf(Connection);
  });

  test("stops retrying if websocket connection fails consistently", async () => {
    simulateImmediatelyReadySession(fetchMock);
    simulateSocketWithTransitentConnectionErrors(MockWebSocket, {
      numInitialFailures: NUM_RESLIENCY_RETRIES + 1,
    });
    const connection = createConnectionUnderTest();
    vi.runAllTimersAsync();
    await expect(connection).rejects.toBeInstanceOf(Error);
  });

  test('retries if websocket connection times out"', async () => {
    simulateImmediatelyReadySession(fetchMock);
    simulateSocketWithConnectionTimeout(MockWebSocket, {
      numTimeouts: NUM_RESLIENCY_RETRIES,
    });
    const connection = createConnectionUnderTest();
    vi.runAllTimersAsync();
    await expect(connection).resolves.toBeInstanceOf(Connection);
  });

  test("stops retrying if websocket connection times out consistently", async () => {
    simulateImmediatelyReadySession(fetchMock);
    simulateSocketWithConnectionTimeout(MockWebSocket, {
      numTimeouts: NUM_RESLIENCY_RETRIES + 1,
    });
    const connection = createConnectionUnderTest();
    vi.runAllTimersAsync();
    await expect(connection).rejects.toBeInstanceOf(Error);
  });
});

describe("Connection#execute, when executing a single SQL statement", async () => {
  test("resolves with the result of the statement", async () => {
    simulateImmediatelyReadySession(fetchMock);
    simulateSocketWithSingleExecution(MockWebSocket);
    const connection = createConnectionUnderTest();
    vi.runAllTimersAsync();
    const result = (await connection)
      .execute("SHOW SCHEMAS IN wherobots_open_data")
      .then((table) => table.toArray().map((row) => row.toJSON()));
    vi.runAllTimersAsync();
    await expect(result).resolves.toEqual(showSchemasExpectedPayload);
    expect(getSentMessages(MockWebSocket)).toEqual([
      expect.objectContaining({ kind: "execute_sql" }),
      expect.objectContaining({ kind: "retrieve_results" }),
    ]);
  });

  test("rejects if the execution returns an error", async () => {
    simulateImmediatelyReadySession(fetchMock);
    simulateSocketWithSingleExecutionError(MockWebSocket);
    const connection = createConnectionUnderTest();
    vi.runAllTimersAsync();
    const result = (await connection).execute(
      "SHOW SCHEMAS IN wherobots_open_data",
    );
    vi.runAllTimersAsync();
    await expect(result).rejects.toBeInstanceOf(Error);
  });

  test("rejects if there is a connection error", async () => {
    simulateImmediatelyReadySession(fetchMock);
    simulateSocketWithConnectionError(MockWebSocket);
    const connection = createConnectionUnderTest();
    vi.runAllTimersAsync();
    const result = (await connection).execute(
      "SHOW SCHEMAS IN wherobots_open_data",
    );
    vi.runAllTimersAsync();
    await expect(result).rejects.toBeInstanceOf(Error);
    expect(wasSocketClosed(MockWebSocket)).toEqual(true);
  });

  test("rejects if the connection is closed remotely", async () => {
    simulateImmediatelyReadySession(fetchMock);
    simulateSocketWithConnectionClosed(MockWebSocket);
    const connection = createConnectionUnderTest();
    vi.runAllTimersAsync();
    const result = (await connection).execute(
      "SHOW SCHEMAS IN wherobots_open_data",
    );
    vi.runAllTimersAsync();
    await expect(result).rejects.toBeInstanceOf(Error);
  });

  test("removes all socket listeners when connection is closed", async () => {
    simulateImmediatelyReadySession(fetchMock);
    simulateSocketWithSingleExecution(MockWebSocket);
    const connection = createConnectionUnderTest();
    vi.runAllTimersAsync();
    const result = (await connection)
      .execute("SHOW SCHEMAS IN wherobots_open_data")
      .then((table) => table.toArray().map((row) => row.toJSON()));
    vi.runAllTimersAsync();
    await result;
    (await connection).close();
    expectAllSocketListenersRemoved(MockWebSocket);
  });

  test("sends cancellation if execution is aborted", async () => {
    simulateImmediatelyReadySession(fetchMock);
    const { resume } = simulateSocketWithSingleExecutionPaused(MockWebSocket);
    const connection = createConnectionUnderTest();
    vi.runAllTimersAsync();
    const abortController = new AbortController();
    const result = (await connection).execute(
      "SHOW SCHEMAS IN wherobots_open_data",
      { signal: abortController.signal },
    );
    vi.runAllTimersAsync();
    expect(getSentMessages(MockWebSocket)).toEqual([
      expect.objectContaining({ kind: "execute_sql" }),
    ]);
    // aborting the execution before resuming the simulated socket should cause the promise to reject
    // and no additional messages to be sent for this execution
    abortController.abort();
    resume();
    vi.runAllTimersAsync();
    await expect(result).rejects.toBeInstanceOf(Error);
    expect(getSentMessages(MockWebSocket)).toEqual([
      expect.objectContaining({ kind: "execute_sql" }),
      expect.objectContaining({ kind: "cancel" }),
    ]);
    expect(wasSocketClosed(MockWebSocket)).toEqual(false);
  });

  test("filters error events by execution ID to prevent cross-contamination between parallel executions", async () => {
    // This test verifies the fix for the execution ID filtering in waitForMessage
    // It simulates the case where an error event with a different execution_id
    // should NOT affect other executions waiting for messages
    simulateImmediatelyReadySession(fetchMock);

    MockWebSocket.mockImplementation(() => {
      const instance = mockWebSocketDefaultImplementation();
      simulateHandleOpen(instance);

      // Handle the first execute_sql message
      instance.send.mockImplementationOnce((data: string) => {
        simulateStateUpdateSuccess(instance, data);
      });

      // Handle the retrieve_results message
      instance.send.mockImplementationOnce((data: string) => {
        // Send an error event with a DIFFERENT execution_id to test filtering
        const wrongExecutionId = "wrong-execution-id-12345";
        setTimeout(() => {
          simulateWebSocketEvent(instance, {
            type: "message",
            data: JSON.stringify({
              kind: "error",
              execution_id: wrongExecutionId, // Different ID!
              message: "Error from different execution",
            }),
          } as WebSocket.MessageEvent);
        }, 10);

        // Then send the actual result with correct execution_id
        setTimeout(() => {
          simulateExecutionResult(instance, data, {
            result_bytes: showSchemasPayloadBrotli,
          });
        }, 50);
      });

      return instance;
    });

    const connection = createConnectionUnderTest();
    vi.runAllTimersAsync();

    // This execution should complete successfully despite the error event with wrong ID
    const resultPromise = (await connection).execute(
      "SHOW SCHEMAS IN wherobots_open_data",
    );

    vi.runAllTimersAsync();

    // The execution should succeed because the error with wrong execution_id is filtered out
    const result = await resultPromise;
    expect(result).toBeDefined();

    expect(wasSocketClosed(MockWebSocket)).toEqual(false);
  });
});

describe("Connection#execute, when executing multiple SQL statements", async () => {
  test("maps results to the correct execution if they are received out of order", async () => {
    simulateImmediatelyReadySession(fetchMock);
    simulateSocketWithMultipleExecutions(MockWebSocket);
    const connection = createConnectionUnderTest();
    vi.runAllTimersAsync();
    const resultOne = (await connection)
      .execute("SHOW SCHEMAS IN wherobots_open_data")
      .then((table) => table.toArray().map((row) => row.toJSON()));
    const resultTwo = (await connection)
      .execute("SHOW tables IN wherobots_open_data.overture")
      .then((table) => table.toArray().map((row) => row.toJSON()));
    vi.runAllTimersAsync();
    await expect(resultOne).resolves.toEqual(showSchemasExpectedPayload);
    await expect(resultTwo).resolves.toEqual(showTablesExpectedPayload);
  });

  test("rejects only a specific execution if it fails", async () => {
    simulateImmediatelyReadySession(fetchMock);
    simulateSocketWithMultipleExecutionsOneError(MockWebSocket);
    const connection = createConnectionUnderTest();
    vi.runAllTimersAsync();
    const resultOne = (await connection)
      .execute("SHOW SCHEMAS IN wherobots_open_data")
      .then((table) => table.toArray().map((row) => row.toJSON()));
    const resultTwo = (await connection)
      .execute("SHOW tables IN wherobots_open_data.overture")
      .then((table) => table.toArray().map((row) => row.toJSON()));
    vi.runAllTimersAsync();
    await expect(resultOne).rejects.toBeInstanceOf(Error);
    await expect(resultTwo).resolves.toEqual(showTablesExpectedPayload);
    expect(wasSocketClosed(MockWebSocket)).toEqual(false);
  });

  test("removes all socket listeners when connection is closed", async () => {
    simulateImmediatelyReadySession(fetchMock);
    simulateSocketWithMultipleExecutions(MockWebSocket);
    const connection = createConnectionUnderTest();
    vi.runAllTimersAsync();
    const resultOne = (await connection)
      .execute("SHOW SCHEMAS IN wherobots_open_data")
      .then((table) => table.toArray().map((row) => row.toJSON()));
    const resultTwo = (await connection)
      .execute("SHOW tables IN wherobots_open_data.overture")
      .then((table) => table.toArray().map((row) => row.toJSON()));
    vi.runAllTimersAsync();
    await resultOne;
    await resultTwo;
    (await connection).close();
    expectAllSocketListenersRemoved(MockWebSocket);
  });
});
