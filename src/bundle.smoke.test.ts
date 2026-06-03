import * as esbuild from "esbuild";
import path from "path";
import { beforeAll, describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..");

// Mirrors the externals tsup uses for the published builds, so the bundled
// output contains only this package's own code. Anything Node-only must come
// from our code, not a dependency.
const EXTERNAL = [
  "apache-arrow",
  "cbor-x",
  "uuid",
  "zod",
  "ws",
  "pino",
  "pino-pretty",
];

const bundleFor = async (platform: "node" | "browser"): Promise<string> => {
  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, "src/index.ts")],
    bundle: true,
    format: "esm",
    platform,
    write: false,
    external: EXTERNAL,
    alias: { "@platform": path.join(ROOT, `src/platform/${platform}.ts`) },
    logLevel: "silent",
  });
  return result.outputFiles[0]!.text;
};

describe("browser bundle is free of Node-only references", () => {
  const FORBIDDEN = [
    '"ws"',
    "pino-pretty",
    "read-pkg-up",
    "zlib",
    "process.env",
    "process.platform",
    "process.version",
    "__dirname",
  ];

  // Bundle once and assert against the shared output (a fresh esbuild per
  // assertion would be needlessly slow).
  let browserBundle: string;
  beforeAll(async () => {
    browserBundle = await bundleFor("browser");
  });

  test.each(FORBIDDEN)("does not reference %s", (token) => {
    expect(browserBundle).not.toContain(token);
  });
});

describe("node bundle wires up the Node implementation", () => {
  test("references ws and zlib", async () => {
    const code = await bundleFor("node");
    expect(code).toContain("ws");
    expect(code).toContain("zlib");
  });
});
