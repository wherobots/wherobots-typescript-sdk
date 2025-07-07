import { encode } from "cbor";
import { readFileSync } from "fs";
import { resolve } from "path";
import WebSocket from "ws";
import { vi, MockedFunction, expect } from "vitest";
import {
  ErrorEvent,
  EventWithExecutionIdSchema,
  ExecuteSQLEventSchema,
  ExecutionResultEvent,
  RetrieveResultsEvent,
  RetrieveResultsEventSchema,
  StateUpdatedEvent,
} from "@/schemas";
import {
  DataCompression,
  GeometryRepresentation,
  ResultsFormat,
} from "@/constants";

const showSchemasPayloadBrotli = readFileSync(
  resolve(__dirname, "./payloads/showSchemas.br"),
);

const showTablesPayloadBrotli = readFileSync(
  resolve(__dirname, "./payloads/showTables.br"),
);

type MockWebSocket = MockedFunction<
  () => {
    send: MockedFunction<WebSocket["send"]>;
    close: MockedFunction<WebSocket["close"]>;
    addEventListener: MockedFunction<WebSocket["addEventListener"]>;
    removeEventListener: MockedFunction<WebSocket["removeEventListener"]>;
  }
>;

export const createMockWebSocket = () => {
  const mockWebSocket = vi.fn() as MockWebSocket;
  resetMockWebSocket(mockWebSocket);
  return mockWebSocket;
};

const mockWebSocketDefaultImplementation = () => ({
  send: vi.fn(),
  close: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
});

export const resetMockWebSocket = (mockWebSocket: MockWebSocket) => {
  mockWebSocket
    .mockReset()
    .mockImplementation(mockWebSocketDefaultImplementation);
};

const simulateWebSocketEvent = (
  socketInstance: ReturnType<MockWebSocket>,
  e: WebSocket.MessageEvent | WebSocket.Event | WebSocket.CloseEvent,
) => {
  const { type } = e;
  const listeners = socketInstance.addEventListener.mock.calls.filter(
    (call) => call[0] === type,
  );
  listeners.forEach((call) => {
    call[1](e);
  });
};

const simulateHandleOpen = (socketInstance: ReturnType<MockWebSocket>) => {
  setTimeout(() =>
    simulateWebSocketEvent(socketInstance, {
      type: "open",
    } as WebSocket.Event),
  );
};

const simulateStateUpdateSuccess = (
  socketInstance: ReturnType<MockWebSocket>,
  sentData: string,
) => {
  const message = ExecuteSQLEventSchema.parse(JSON.parse(sentData));
  setTimeout(() =>
    simulateWebSocketEvent(socketInstance, {
      type: "message",
      data: JSON.stringify({
        kind: "state_updated",
        execution_id: message.execution_id,
        state: "succeeded",
      } satisfies StateUpdatedEvent),
    } as WebSocket.MessageEvent),
  );
};

const simulateExecutionError = (
  socketInstance: ReturnType<MockWebSocket>,
  sentData: string,
  options?: { delay: number },
) => {
  const message = EventWithExecutionIdSchema.parse(JSON.parse(sentData));
  setTimeout(
    () =>
      simulateWebSocketEvent(socketInstance, {
        type: "message",
        data: JSON.stringify({
          kind: "error",
          execution_id: message.execution_id,
          message: "Error executing SQL",
        } satisfies ErrorEvent),
      } as WebSocket.MessageEvent),
    options?.delay,
  );
};

const simulateExecutionResult = (
  socketInstance: ReturnType<MockWebSocket>,
  sentData: string,
  result: Partial<ExecutionResultEvent["results"]> & {
    result_bytes: Buffer;
  },
  options?: { delay: number },
) => {
  const message = RetrieveResultsEventSchema.parse(JSON.parse(sentData));
  if (message.kind === "retrieve_results") {
    setTimeout(
      () =>
        simulateWebSocketEvent(socketInstance, {
          type: "message",
          data: encode({
            kind: "execution_result",
            execution_id: message.execution_id,
            state: "succeeded",
            results: {
              geometry: GeometryRepresentation.EWKT,
              compression: DataCompression.BROTLI,
              format: ResultsFormat.ARROW,
              geo_columns: [],
              ...result,
            },
          } satisfies ExecutionResultEvent),
        } as WebSocket.MessageEvent),
      options?.delay,
    );
  }
};

export const simulateImmediatelyOpenSocket = (mockWebSocket: MockWebSocket) => {
  mockWebSocket.mockImplementation(() => {
    const instance = mockWebSocketDefaultImplementation();
    simulateHandleOpen(instance);
    return instance;
  });
};

export const simulateSocketWithTransitentConnectionErrors = (
  mockWebSocket: MockWebSocket,
  options: { numInitialFailures: number },
) => {
  Array.from(Array(options.numInitialFailures)).forEach(() => {
    mockWebSocket.mockImplementationOnce(() => {
      const instance = mockWebSocketDefaultImplementation();
      setTimeout(() =>
        simulateWebSocketEvent(instance, {
          type: "error",
        } as WebSocket.Event),
      );
      return instance;
    });
  });
  simulateImmediatelyOpenSocket(mockWebSocket);
};

export const simulateSocketWithConnectionTimeout = (
  mockWebSocket: MockWebSocket,
  options: { numTimeouts: number },
) => {
  Array.from(Array(options.numTimeouts)).forEach(() => {
    // simulate a connection timeout by never sending an open event
    mockWebSocket.mockImplementationOnce(() => {
      const instance = mockWebSocketDefaultImplementation();
      return instance;
    });
  });
  simulateImmediatelyOpenSocket(mockWebSocket);
};

export const simulateSocketWithSingleExecution = (
  mockWebSocket: MockWebSocket,
) => {
  mockWebSocket.mockImplementation(() => {
    const instance = mockWebSocketDefaultImplementation();
    simulateHandleOpen(instance);
    instance.send.mockImplementationOnce((data: string) => {
      simulateStateUpdateSuccess(instance, data);
    });
    instance.send.mockImplementationOnce((data: string) => {
      simulateExecutionResult(instance, data, {
        result_bytes: showSchemasPayloadBrotli,
      });
    });
    return instance;
  });
};

// this simulates a socket that will pause after receiving the message to execute SQL,
// and returns a function that will "resume" by responding to the execute SQL message,
// and also the message to retrieve results
export const simulateSocketWithSingleExecutionPaused = (
  mockWebSocket: MockWebSocket,
) => {
  let instance: ReturnType<typeof mockWebSocketDefaultImplementation>;
  let resumeData: string;
  const resume = () => {
    simulateStateUpdateSuccess(instance, resumeData);
    instance.send.mockImplementationOnce((data: string) => {
      simulateExecutionResult(instance, data, {
        result_bytes: showSchemasPayloadBrotli,
      });
    });
  };

  mockWebSocket.mockImplementation(() => {
    instance = mockWebSocketDefaultImplementation();
    simulateHandleOpen(instance);
    instance.send.mockImplementationOnce((data: string) => {
      resumeData = data;
    });
    return instance;
  });
  return { resume };
};

export const simulateSocketWithSingleExecutionError = (
  mockWebSocket: MockWebSocket,
) => {
  mockWebSocket.mockImplementation(() => {
    const instance = mockWebSocketDefaultImplementation();
    simulateHandleOpen(instance);
    instance.send.mockImplementationOnce((data: string) => {
      simulateExecutionError(instance, data);
    });
    return instance;
  });
};

export const simulateSocketWithConnectionError = (
  mockWebSocket: MockWebSocket,
) => {
  mockWebSocket.mockImplementation(() => {
    const instance = mockWebSocketDefaultImplementation();
    simulateHandleOpen(instance);
    instance.send.mockImplementationOnce(() => {
      setTimeout(() =>
        simulateWebSocketEvent(instance, {
          type: "error",
          message: "Error connecting to WebSocket",
        } as WebSocket.ErrorEvent),
      );
    });
    return instance;
  });
};

export const simulateSocketWithConnectionClosed = (
  mockWebSocket: MockWebSocket,
) => {
  mockWebSocket.mockImplementation(() => {
    const instance = mockWebSocketDefaultImplementation();
    simulateHandleOpen(instance);
    instance.send.mockImplementationOnce(() => {
      setTimeout(() =>
        simulateWebSocketEvent(instance, {
          type: "close",
          reason: "Connection closed",
        } as WebSocket.CloseEvent),
      );
    });
    return instance;
  });
};

export const simulateSocketWithMultipleExecutions = (
  mockWebSocket: MockWebSocket,
) => {
  mockWebSocket.mockImplementation(() => {
    const instance = mockWebSocketDefaultImplementation();
    simulateHandleOpen(instance);
    let executionIdOne = "";
    let executionIdTwo = "";
    instance.send.mockImplementationOnce((data: string) => {
      executionIdOne = JSON.parse(data).execution_id;
      simulateStateUpdateSuccess(instance, data);
    });
    instance.send.mockImplementationOnce((data: string) => {
      executionIdTwo = JSON.parse(data).execution_id;
      simulateStateUpdateSuccess(instance, data);
    });
    instance.send.mockImplementation((data: string) => {
      const message: RetrieveResultsEvent = JSON.parse(data);
      if (message.execution_id === executionIdOne) {
        // respond to the first execution with a larger delay to simulate out-of-order responses
        simulateExecutionResult(
          instance,
          data,
          { result_bytes: showSchemasPayloadBrotli },
          { delay: 100 },
        );
      } else if (message.execution_id === executionIdTwo) {
        simulateExecutionResult(instance, data, {
          result_bytes: showTablesPayloadBrotli,
        });
      }
    });
    return instance;
  });
};

export const simulateSocketWithMultipleExecutionsOneError = (
  mockWebSocket: MockWebSocket,
) => {
  mockWebSocket.mockImplementation(() => {
    const instance = mockWebSocketDefaultImplementation();
    simulateHandleOpen(instance);
    let executionIdOne = "";
    let executionIdTwo = "";
    instance.send.mockImplementationOnce((data: string) => {
      executionIdOne = JSON.parse(data).execution_id;
      simulateStateUpdateSuccess(instance, data);
    });
    instance.send.mockImplementationOnce((data: string) => {
      executionIdTwo = JSON.parse(data).execution_id;
      simulateStateUpdateSuccess(instance, data);
    });
    instance.send.mockImplementation((data: string) => {
      const message: RetrieveResultsEvent = JSON.parse(data);
      if (message.execution_id === executionIdOne) {
        simulateExecutionError(instance, data, { delay: 100 });
      } else if (message.execution_id === executionIdTwo) {
        simulateExecutionResult(instance, data, {
          result_bytes: showTablesPayloadBrotli,
        });
      }
    });
    return instance;
  });
};

export const expectAllSocketListenersRemoved = (
  mockWebSocket: MockWebSocket,
) => {
  const [instance] = mockWebSocket.mock.results;
  expect(
    instance?.value.removeEventListener.mock.calls.length,
  ).toBeGreaterThanOrEqual(instance?.value.addEventListener.mock.calls.length);
};

export const getSentMessages = (mockWebSocket: MockWebSocket) => {
  const [instance] = mockWebSocket.mock.results;
  return instance?.value.send.mock.calls.map((call: [string]) =>
    JSON.parse(call[0]),
  );
};

export const wasSocketClosed = (mockWebSocket: MockWebSocket) => {
  const [instance] = mockWebSocket.mock.results;
  return instance?.value.close.mock.calls.length > 0;
};
