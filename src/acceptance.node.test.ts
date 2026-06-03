import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Connection } from "./connection";
import { DataCompression } from "./constants";
import {
  EXPECTED_SHOW_SCHEMAS_ROWS,
  MockSessionServer,
  startMockSessionServer,
} from "./testing/mockSessionServer";

// End-to-end acceptance test for the Node build: a real WebSocket (`ws`), real
// brotli/gzip decompression, real cbor-x decode and Arrow parsing, driven
// through the public Connection API against a local server that speaks the real
// session protocol. No mocking of the SDK internals, no secrets, no live
// runtime.
describe("Node acceptance (end-to-end against the mock session server)", () => {
  let server: MockSessionServer;

  beforeEach(async () => {
    server = await startMockSessionServer();
  });

  afterEach(async () => {
    await server.close();
  });

  const runQuery = async (options: {
    token?: string;
    apiKey?: string;
    dataCompression?: DataCompression;
  }) => {
    const connection = await Connection.connect({
      ...options,
      apiUrl: server.apiUrl,
    });
    try {
      const table = await connection.execute(
        "SHOW SCHEMAS IN wherobots_open_data",
      );
      return table.toArray().map((row) => row.toJSON());
    } finally {
      connection.close();
    }
  };

  test("bearer token: connects, executes, decodes Arrow, requests brotli", async () => {
    const rows = await runQuery({ token: "test-bearer" });

    expect(rows).toEqual(EXPECTED_SHOW_SCHEMAS_ROWS);
    // The bearer token reached both the REST session calls and the WS handshake.
    expect(server.restAuth.authorization).toBe("Bearer test-bearer");
    expect(server.wsAuth.authorization).toBe("Bearer test-bearer");
    expect(server.restAuth.apiKey).toBeUndefined();
    // Node's default result compression is brotli.
    expect(server.retrieveRequests).toHaveLength(1);
    expect(server.retrieveRequests[0]?.compression).toBe(
      DataCompression.BROTLI,
    );
  });

  test("api key: authenticates via the X-API-Key header", async () => {
    const rows = await runQuery({ apiKey: "test-api-key" });

    expect(rows).toEqual(EXPECTED_SHOW_SCHEMAS_ROWS);
    expect(server.restAuth.apiKey).toBe("test-api-key");
    expect(server.wsAuth.apiKey).toBe("test-api-key");
    expect(server.restAuth.authorization).toBeUndefined();
  });

  test("can request and decode gzip results in Node", async () => {
    const rows = await runQuery({
      token: "test-bearer",
      dataCompression: DataCompression.GZIP,
    });

    expect(rows).toEqual(EXPECTED_SHOW_SCHEMAS_ROWS);
    expect(server.retrieveRequests[0]?.compression).toBe(DataCompression.GZIP);
  });

  test("can request and decode uncompressed (none) results", async () => {
    const rows = await runQuery({
      token: "test-bearer",
      dataCompression: DataCompression.NONE,
    });

    expect(rows).toEqual(EXPECTED_SHOW_SCHEMAS_ROWS);
    expect(server.retrieveRequests[0]?.compression).toBe(DataCompression.NONE);
  });
});
