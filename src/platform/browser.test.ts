import { afterEach, describe, expect, test, vi } from "vitest";
import { platform } from "./browser";
import { Files } from "../files/files";

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

describe("browser platform Files", () => {
  const browserFiles = (f: typeof fetch) =>
    new Files(
      { token: "tok", apiUrl: "https://api.test", region: "aws-us-west-2" },
      { fetch: f, platform },
    );

  test("rejects an apiKey", () => {
    expect(() => new Files({ apiKey: "k", region: "r" }, { platform })).toThrow(
      /apiKey/,
    );
  });

  test("download sends only the bearer token and returns a Blob", async () => {
    const calls: RequestInit[] = [];
    const f = (async (_url: string, init: RequestInit) => {
      calls.push(init);
      return new Response("bytes");
    }) as unknown as typeof fetch;
    const blob = await browserFiles(f).myFiles.download("a.txt");
    expect(blob).toBeInstanceOf(Blob);
    expect(await blob.text()).toBe("bytes");
    expect(calls[0]!.headers).toEqual({ Authorization: "Bearer tok" });
    expect(calls[0]!.redirect).toBe("follow");
  });

  test("a failure after the redirect is a storage error", async () => {
    const f = (async () => {
      const res = new Response("", { status: 403 });
      Object.defineProperty(res, "redirected", { value: true });
      return res;
    }) as unknown as typeof fetch;
    await expect(browserFiles(f).myFiles.download("a")).rejects.toThrow(
      /from storage failed \(HTTP 403\)/,
    );
  });

  test("refuses local file paths", async () => {
    const f = (async () => new Response("")) as unknown as typeof fetch;
    const drive = browserFiles(f).myFiles;
    await expect(drive.upload("a", "/tmp/a")).rejects.toThrow(/Blob/);
    await expect(drive.downloadTo("a", "/tmp/a")).rejects.toThrow(/Blob/);
  });
});
