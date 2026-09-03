import { test, expect } from "@playwright/test";
import * as esbuild from "esbuild";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  EXPECTED_SHOW_SCHEMAS_ROWS,
  MockSessionServer,
  startMockSessionServer,
} from "../../src/testing/mockSessionServer";
import { DataCompression } from "../../src/constants";

const ROOT = path.resolve(__dirname, "../..");

const PAGE_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>SDK browser acceptance</title></head>
  <body>
    <script type="module">
      import "/sdk.mjs";
    </script>
  </body>
</html>`;

// Bundle the browser entry once: resolve @platform to the browser
// implementation and inline every dependency so a raw <script type="module">
// can load it with no import map.
const buildBrowserBundle = async (): Promise<string> => {
  const outfile = path.join(
    mkdtempSync(path.join(tmpdir(), "wb-sdk-browser-")),
    "sdk.mjs",
  );
  await esbuild.build({
    entryPoints: [path.join(ROOT, "tests/browser/entry.ts")],
    bundle: true,
    format: "esm",
    platform: "browser",
    outfile,
    alias: { "@platform": path.join(ROOT, "src/platform/browser.ts") },
    logLevel: "silent",
  });
  return outfile;
};

let server: MockSessionServer;

test.beforeAll(async () => {
  const bundlePath = await buildBrowserBundle();
  server = await startMockSessionServer({
    page: { html: PAGE_HTML, bundlePath },
  });
});

test.afterAll(async () => {
  await server?.close();
});

test("browser end-to-end: native WebSocket + cookie auth + gzip decode", async ({
  context,
  page,
}) => {
  // The WorkOS bearer token lives in the wherobotsToken cookie. Because the
  // page origin and the WS host share the host, the browser sends it on the
  // WS upgrade automatically — no header, no token in the URL.
  await context.addCookies([
    {
      name: "wherobotsToken",
      value: "cookie-bearer-token",
      url: server.apiUrl,
    },
  ]);

  await page.goto(server.apiUrl);
  await page.waitForFunction(() => typeof window.runQuery === "function");

  const rows = await page.evaluate(
    ({ apiUrl }) =>
      window.runQuery({
        apiUrl,
        // REST is authenticated with the bearer token; the WS upgrade uses the
        // cookie above.
        token: "rest-bearer-token",
        statement: "SHOW SCHEMAS IN wherobots_open_data",
      }),
    { apiUrl: server.apiUrl },
  );

  // (a) The full browser path works: native WebSocket + DecompressionStream
  // (gzip) + cbor-x + Arrow produced the expected rows.
  expect(rows).toEqual(EXPECTED_SHOW_SCHEMAS_ROWS);

  // (b) The WS upgrade authenticated via the cookie, with no header and no
  // credential in the URL.
  expect(server.wsAuth.cookie).toContain("wherobotsToken=cookie-bearer-token");
  expect(server.wsAuth.authorization).toBeUndefined();
  expect(server.wsAuth.apiKey).toBeUndefined();
  expect(server.wsAuth.queryToken).toBeUndefined();
  // REST still carried the bearer token.
  expect(server.restAuth.authorization).toBe("Bearer rest-bearer-token");

  // (c) The browser requested gzip (its platform default).
  expect(server.retrieveRequests).toHaveLength(1);
  expect(server.retrieveRequests[0]?.compression).toBe(DataCompression.GZIP);
});

test("browser end-to-end: apiKey is rejected at connect time", async ({
  page,
}) => {
  // The `?token=` query-param channel was removed server-side (goproxy), and
  // a key in a URL leaks into history/Referer/proxy logs anyway, so an apiKey
  // can no longer authenticate a browser WebSocket. The connection must fail
  // fast with a clear error, before any request is sent.
  await page.goto(server.apiUrl);
  await page.waitForFunction(() => typeof window.runQuery === "function");

  await expect(
    page.evaluate(
      ({ apiUrl }) =>
        window.runQuery({
          apiUrl,
          apiKey: "browser-api-key",
          statement: "SHOW SCHEMAS IN wherobots_open_data",
        }),
      { apiUrl: server.apiUrl },
    ),
  ).rejects.toThrow("apiKey auth is not supported");

  // Nothing reached the server: no REST session call, no WS upgrade.
  expect(server.restAuth.apiKey).toBeUndefined();
  expect(server.wsAuth.queryToken).toBeUndefined();
});
