import { readFileSync } from "fs";
import { resolve } from "path";
import { expect, test, describe, vi, beforeEach } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import fetchMockBuilder from "vitest-fetch-mock";
import { Connection } from "./connection";
import { Runtime } from "./constants";
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
  resetMockWebSocket,
  simulateImmediatelyOpenSocket,
  simulateSocketWithConnectionClosed,
  simulateSocketWithConnectionError,
  simulateSocketWithMultipleExecutions,
  simulateSocketWithMultipleExecutionsOneError,
  simulateSocketWithSingleExecution,
  simulateSocketWithSingleExecutionError,
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

const createConnectionUnderTest = () =>
  Connection.connect(
    {
      apiKey: "00000000-0000-0000-0000-000000000000",
      runtime: Runtime.SEDONA,
    },
    testHarness,
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
  });

  test("rejects if given invalid arguments", async () => {
    const connection = Connection.connect(
      {
        apiKey: "00000000-0000-0000-0000-000000000000",
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
