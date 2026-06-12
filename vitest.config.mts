import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    // Node unit + acceptance tests live in src/. The Playwright browser spec in
    // tests/browser/ is run by `playwright test`, not vitest.
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: [
      {
        find: "@/",
        replacement: resolve(__dirname, "src/") + "/",
      },
      {
        // Node tests exercise the Node platform implementation. The browser
        // implementation is validated directly (decompress unit test) and via
        // the Playwright acceptance test.
        find: "@platform",
        replacement: resolve(__dirname, "src/platform/node.ts"),
      },
    ],
  },
});
