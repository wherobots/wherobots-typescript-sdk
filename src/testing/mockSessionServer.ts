import http from "http";
import zlib from "zlib";
import { readFileSync } from "fs";
import { resolve } from "path";
import { WebSocketServer } from "ws";
import { encode } from "cbor-x";
import {
  DataCompression,
  GeometryRepresentation,
  ResultsFormat,
} from "../constants";

// A local server that speaks the real Wherobots SQL session protocol end to
// end, so acceptance tests exercise the SDK's true code path (fetch, WebSocket,
// decompression, cbor-x decode, Arrow) with no secrets or live runtime. It is
// used both directly (Node acceptance test) and as the page+API+WS origin for
// the browser (Playwright) acceptance test.

const RAW_ARROW = new Uint8Array(
  readFileSync(resolve(__dirname, "./payloads/showSchemas.arrow")),
);

// The rows showSchemas.arrow decodes to — the expected acceptance-test result.
export const EXPECTED_SHOW_SCHEMAS_ROWS = JSON.parse(
  readFileSync(resolve(__dirname, "./payloads/showSchemas.json"), {
    encoding: "utf-8",
  }),
) as Array<Record<string, unknown>>;

const compress = (bytes: Uint8Array, compression: DataCompression): Buffer => {
  switch (compression) {
    case DataCompression.GZIP:
      return zlib.gzipSync(bytes);
    case DataCompression.BROTLI:
      return zlib.brotliCompressSync(bytes);
    case DataCompression.NONE:
      return Buffer.from(bytes);
    default:
      throw new Error(`Unsupported compression: ${compression}`);
  }
};

export interface CapturedAuth {
  authorization?: string | undefined;
  apiKey?: string | undefined;
  cookie?: string | undefined;
}

export interface MockSessionServer {
  // Base URL to pass as the connection's `apiUrl`. Same origin serves REST,
  // the WebSocket, and (when configured) the browser test page.
  apiUrl: string;
  port: number;
  // Auth observed on the REST session calls and the WebSocket upgrade.
  restAuth: CapturedAuth;
  wsAuth: CapturedAuth;
  // The retrieve_results events the client sent (for compression assertions).
  retrieveRequests: Array<{ compression: DataCompression; geometry: string }>;
  close: () => Promise<void>;
}

export interface MockSessionServerOptions {
  // When set, GET / serves this HTML and GET /sdk.mjs serves the file at
  // `bundlePath` (the built browser SDK bundle) — used by the browser test.
  page?: { html: string; bundlePath: string };
}

const captureAuth = (headers: http.IncomingHttpHeaders): CapturedAuth => ({
  authorization: headers.authorization,
  apiKey: (headers["x-api-key"] as string | undefined) ?? undefined,
  cookie: headers.cookie,
});

const setCors = (req: http.IncomingMessage, res: http.ServerResponse) => {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "*, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
};

export const startMockSessionServer = async (
  options: MockSessionServerOptions = {},
): Promise<MockSessionServer> => {
  const restAuth: CapturedAuth = {};
  const wsAuth: CapturedAuth = {};
  const retrieveRequests: MockSessionServer["retrieveRequests"] = [];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    setCors(req, res);

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    // Browser test assets (same origin as REST + WS so the cookie is sent).
    if (options.page && req.method === "GET" && url.pathname === "/") {
      res
        .writeHead(200, { "Content-Type": "text/html" })
        .end(options.page.html);
      return;
    }
    if (options.page && req.method === "GET" && url.pathname === "/sdk.mjs") {
      res
        .writeHead(200, { "Content-Type": "text/javascript" })
        .end(readFileSync(options.page.bundlePath));
      return;
    }

    // POST /sql/session -> a freshly-created (not-yet-ready) session.
    if (req.method === "POST" && url.pathname === "/sql/session") {
      Object.assign(restAuth, captureAuth(req.headers));
      // drain the body
      req.on("data", () => {});
      req.on("end", () => {
        res
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify({ id: "test-session", status: "PENDING" }));
      });
      return;
    }

    // GET /sql/session/{id} -> a READY session pointing the WS back here.
    if (req.method === "GET" && url.pathname.startsWith("/sql/session/")) {
      Object.assign(restAuth, captureAuth(req.headers));
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          id: "test-session",
          status: "READY",
          // http -> ws via the SDK's toWsUrl(); the WS server accepts any path.
          appMeta: { url: `http://127.0.0.1:${port}` },
        }),
      );
      return;
    }

    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ server });
  wss.on("connection", (socket, req) => {
    Object.assign(wsAuth, captureAuth(req.headers));
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      if (message.kind === "execute_sql") {
        socket.send(
          JSON.stringify({
            kind: "state_updated",
            execution_id: message.execution_id,
            state: "succeeded",
          }),
        );
      } else if (message.kind === "retrieve_results") {
        const compression: DataCompression = message.compression;
        retrieveRequests.push({ compression, geometry: message.geometry });
        const body = compress(RAW_ARROW, compression);
        socket.send(
          encode({
            kind: "execution_result",
            execution_id: message.execution_id,
            state: "succeeded",
            results: {
              result_bytes: body,
              compression,
              format: ResultsFormat.ARROW,
              geometry: message.geometry ?? GeometryRepresentation.EWKT,
              geo_columns: [],
            },
          }),
        );
      }
      // `cancel` events are ignored.
    });
  });

  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind mock session server");
  }
  const port = address.port;

  return {
    apiUrl: `http://127.0.0.1:${port}`,
    port,
    restAuth,
    wsAuth,
    retrieveRequests,
    close: () =>
      new Promise<void>((res, rej) => {
        wss.close();
        server.close((err) => (err ? rej(err) : res()));
      }),
  };
};
