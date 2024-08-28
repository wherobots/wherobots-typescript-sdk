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
  resetMockWebSocket,
  simulateImmediatelyOpenSocket,
} from "./testing/mockSocketBehaviors";

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
});
