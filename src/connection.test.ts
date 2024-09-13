import { readFileSync } from "fs";
import { resolve } from "path";
import { expect, test, describe, vi, beforeEach } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import fetchMockBuilder from "vitest-fetch-mock";
import { Connection } from "./connection";
import { MIN_PROTOCOL_VERSION_FOR_CANCEL, Runtime } from "./constants";
import {
  SESSION_LIFECYCLE_RESPONSES,
  simulateImmediatelyReadySession,
  simulateSessionCreateInvalidResponse,
  simulateSessionCreateUnauthenticated,
  simulateSessionCreationLifecycle,
  simulateSessionPollInvalidResponse,
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
  simulateSocketWithMultipleExecutions,
  simulateSocketWithMultipleExecutionsOneError,
  simulateSocketWithSingleExecution,
  simulateSocketWithSingleExecutionError,
  simulateSocketWithSingleExecutionPaused,
  wasSocketClosed,
} from "./testing/mockSocketBehaviors";

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

const fetchMock = fetchMockBuilder(vi);
const MockWebSocket = createMockWebSocket();

const testHarness = {
  fetch: fetchMock as unknown as typeof fetch,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  WebSocket: MockWebSocket as any,
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

const createConnectionUnderTest = (protocolVersion?: string) =>
  Connection.connect(
    {
      apiKey: testApiKey,
      runtime: Runtime.SEDONA,
    },
    { ...testHarness, protocolVersion },
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
    const connection = Connection.connect(
      {
        runtime: Runtime.SEDONA,
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
          runtime: Runtime.SEDONA,
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
        runtime: "invalid" as unknown as Runtime,
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

  test("rejects if session server returns error while polling", async () => {
    simulateSessionServiceError(fetchMock, { numInitialSuccesses: 2 });
    simulateImmediatelyOpenSocket(MockWebSocket);
    const connection = createConnectionUnderTest();
    await expect(connection).rejects.toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("rejects if session server returns error while polling", async () => {
    simulateSessionPollInvalidResponse(fetchMock, { numInitialSuccesses: 2 });
    simulateImmediatelyOpenSocket(MockWebSocket);
    const connection = createConnectionUnderTest();
    await expect(connection).rejects.toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("removes all socket listeners when connection is closed", async () => {
    simulateImmediatelyReadySession(fetchMock);
    simulateImmediatelyOpenSocket(MockWebSocket);
    const connection = createConnectionUnderTest();
    vi.runAllTimersAsync();
    (await connection).close();
    expectAllSocketListenersRemoved(MockWebSocket);
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

  test("stops listening/sending if execution is aborted", async () => {
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
    ]);
    expect(wasSocketClosed(MockWebSocket)).toEqual(false);
  });

  test("sends cancellation if execution is aborted for protocol version >= 1.1.0", async () => {
    simulateImmediatelyReadySession(fetchMock);
    const { resume } = simulateSocketWithSingleExecutionPaused(MockWebSocket);
    const connection = createConnectionUnderTest(
      MIN_PROTOCOL_VERSION_FOR_CANCEL,
    );
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
