import WebSocket from "ws";
import { vi, MockedFunction } from "vitest";

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
  name: string,
  e: WebSocket.MessageEvent | WebSocket.Event | WebSocket.CloseEvent,
) => {
  const listeners = socketInstance.addEventListener.mock.calls.filter(
    (call) => call[0] === name,
  );
  listeners.forEach((call) => {
    call[1](e);
  });
};

export const simulateImmediatelyOpenSocket = (mockWebSocket: MockWebSocket) => {
  mockWebSocket.mockImplementation(() => {
    const instance = mockWebSocketDefaultImplementation();
    setTimeout(
      () =>
        simulateWebSocketEvent(instance, "open", {
          type: "open",
        } as WebSocket.Event),
      0,
    );
    return instance;
  });
};
