import { afterEach, describe, expect, test, vi } from "vitest";
import { platform } from "./browser";

// Minimal WebSocket stub: captures the URL the platform hands to the
// constructor. Only the surface openSocket touches (binaryType) is modeled.
class StubWebSocket {
  static lastUrl: string | undefined;
  binaryType: string;
  constructor(url: string) {
    StubWebSocket.lastUrl = url;
    this.binaryType = "blob";
  }
}

describe("browser platform openSocket", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Regression guard for the removed `?token=` query-param channel: no auth
  // shape — an apiKey included — may ever leak a credential into the socket
  // URL. (An apiKey connection is rejected earlier, at connect time; this
  // asserts the socket construction itself stays credential-free.)
  test("never appends credentials to the socket URL", () => {
    vi.stubGlobal("WebSocket", StubWebSocket as unknown as typeof WebSocket);
    const url = "wss://api.cloud.wherobots.com/session/test-session/1.0.0";
    const auths = [{}, { token: "bearer-token" }, { apiKey: "secret-api-key" }];

    for (const auth of auths) {
      platform.openSocket(url, auth);
      expect(StubWebSocket.lastUrl).toBe(url);
      expect(StubWebSocket.lastUrl).not.toContain("secret-api-key");
      expect(StubWebSocket.lastUrl).not.toContain("token=");
    }
  });

  test("opens the socket as a binary (arraybuffer) socket", () => {
    vi.stubGlobal("WebSocket", StubWebSocket as unknown as typeof WebSocket);
    const socket = platform.openSocket(
      "wss://host/ws/1.0.0",
      {},
    ) as unknown as StubWebSocket;
    expect(socket.binaryType).toBe("arraybuffer");
  });
});
