import { defineConfig } from "tsup";
import path from "path";

// The SDK ships two builds that differ only in which implementation of the
// `@platform` module is bundled (see src/platform/). Everything else is shared,
// platform-neutral code. The package.json `exports`/`browser` conditions point
// consumers at the matching build.
const platformAlias = (impl: "node" | "browser") => ({
  "@platform": path.resolve(__dirname, `src/platform/${impl}.ts`),
});

const base = {
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"] as ("esm" | "cjs")[],
  sourcemap: true,
  clean: true,
  // Library deps stay external; the consumer's bundler resolves them.
  external: [
    "apache-arrow",
    "cbor-x",
    "uuid",
    "zod",
    "ws",
    "pino",
    "pino-pretty",
  ],
};

export default defineConfig([
  {
    ...base,
    outDir: "dist/node",
    platform: "node",
    dts: true,
    esbuildOptions(options) {
      options.alias = platformAlias("node");
    },
  },
  {
    ...base,
    outDir: "dist/browser",
    platform: "browser",
    dts: true,
    esbuildOptions(options) {
      options.alias = platformAlias("browser");
    },
  },
]);
