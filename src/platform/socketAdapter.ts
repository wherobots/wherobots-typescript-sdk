import { SocketEventMap, SocketEventName, SocketLike } from "./types";

// The minimal surface both `ws` (Node) and the native browser `WebSocket`
// expose. Both already implement the DOM-style addEventListener/removeEventListener
// contract, so we only need to bridge the (compatible) event types — the same
// listener reference is forwarded to the underlying socket, so removal works
// without any bookkeeping.
interface RawSocket {
  send(data: string): void;
  close(): void;
  addEventListener(
    type: string,
    listener: (e: unknown) => void,
    options?: { once?: boolean },
  ): void;
  removeEventListener(type: string, listener: (e: unknown) => void): void;
}

export const adaptSocket = (raw: RawSocket): SocketLike => ({
  send: (data) => raw.send(data),
  close: () => raw.close(),
  addEventListener: <E extends SocketEventName>(
    type: E,
    listener: (e: SocketEventMap[E]) => void,
    options?: { once?: boolean },
  ) => raw.addEventListener(type, listener as (e: unknown) => void, options),
  removeEventListener: <E extends SocketEventName>(
    type: E,
    listener: (e: SocketEventMap[E]) => void,
  ) => raw.removeEventListener(type, listener as (e: unknown) => void),
});
