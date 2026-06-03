// Browser test entry point. Bundled by esbuild (with the `@platform` alias
// pointing at the browser implementation and all deps inlined) and served to a
// real Chromium page by the Playwright acceptance test. It exposes a single
// function the test can drive.
import { Connection } from "../../src/index";

declare global {
  interface Window {
    runQuery: (opts: {
      apiUrl: string;
      token: string;
      statement: string;
    }) => Promise<unknown>;
    runQueryError?: string;
  }
}

window.runQuery = async ({ apiUrl, token, statement }) => {
  try {
    const connection = await Connection.connect({ token, apiUrl });
    const table = await connection.execute(statement);
    const rows = table.toArray().map((row) => row.toJSON());
    connection.close();
    return rows;
  } catch (err) {
    window.runQueryError = err instanceof Error ? err.message : String(err);
    throw err;
  }
};
