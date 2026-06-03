import zlib from "zlib";
import { describe, expect, test } from "vitest";
import { platform as nodePlatform } from "./node";
import { platform as browserPlatform } from "./browser";
import { DataCompression } from "../constants";

const ORIGINAL = new TextEncoder().encode(
  "the quick brown fox ".repeat(64) + "jumps over the lazy dog",
);
const asArray = (bytes: Uint8Array) => Array.from(bytes);

describe("node platform decompress", () => {
  test("round-trips brotli", async () => {
    const compressed = new Uint8Array(zlib.brotliCompressSync(ORIGINAL));
    const out = await nodePlatform.decompress(
      compressed,
      DataCompression.BROTLI,
    );
    expect(asArray(out)).toEqual(asArray(ORIGINAL));
  });

  test("round-trips gzip", async () => {
    const compressed = new Uint8Array(zlib.gzipSync(ORIGINAL));
    const out = await nodePlatform.decompress(compressed, DataCompression.GZIP);
    expect(asArray(out)).toEqual(asArray(ORIGINAL));
  });

  test("passes through uncompressed", async () => {
    const out = await nodePlatform.decompress(ORIGINAL, DataCompression.NONE);
    expect(asArray(out)).toEqual(asArray(ORIGINAL));
  });
});

describe("browser platform decompress", () => {
  test("round-trips gzip via DecompressionStream", async () => {
    const compressed = new Uint8Array(zlib.gzipSync(ORIGINAL));
    const out = await browserPlatform.decompress(
      compressed,
      DataCompression.GZIP,
    );
    expect(asArray(out)).toEqual(asArray(ORIGINAL));
  });

  test("rejects brotli (unsupported in the browser)", async () => {
    await expect(
      browserPlatform.decompress(ORIGINAL, DataCompression.BROTLI),
    ).rejects.toThrow(/[Bb]rotli/);
  });
});
