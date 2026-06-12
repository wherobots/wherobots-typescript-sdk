import { defineConfig, devices } from "@playwright/test";

// The browser acceptance test starts its own mock session server (which also
// serves the page + bundle), so no global webServer is configured here.
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
