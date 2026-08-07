import { describe, expect, it } from "vitest";
import { platform } from "@platform";
import {
  CLIENT_TOKEN,
  MAX_HEADER_BYTES,
  buildHop,
  clientHeaderValue,
  resolvePlatform,
} from "./clientHeader";
import { PACKAGE_VERSION } from "./version";

const byteLength = (value: string) => new TextEncoder().encode(value).length;

describe("buildHop", () => {
  it("renders the token, version and platform", () => {
    expect(buildHop("0.11.1", "linux")).toBe(
      "client=typescript-sdk;ver=0.11.1;plat=linux",
    );
  });

  it("uses the package version and host platform by default", () => {
    expect(buildHop()).toBe(
      `client=${CLIENT_TOKEN};ver=${PACKAGE_VERSION};plat=${resolvePlatform()}`,
    );
  });

  it("omits a parameter it cannot resolve rather than emitting a placeholder", () => {
    // The `client=` token is the part attribution depends on; a missing
    // version must not cost us the hop.
    expect(buildHop("", "linux")).toBe("client=typescript-sdk;plat=linux");
    expect(buildHop("0.11.1", "")).toBe("client=typescript-sdk;ver=0.11.1");
    expect(buildHop("", "")).toBe("client=typescript-sdk");
  });

  it("takes its platform from the platform layer", () => {
    // Vitest resolves `@platform` to the Node implementation, so this asserts
    // the Node value; the browser build swaps in `"browser"` at bundle time,
    // which bundle.smoke.test.ts pins by forbidding `process.platform` there.
    expect(resolvePlatform()).toBe(platform.clientPlatform);
    expect(buildHop()).toContain(`;plat=${platform.clientPlatform}`);
  });

  it("neutralizes grammar delimiters in a parameter", () => {
    const hop = buildHop("1.0;cmd=evil,client=spoofed", "li;nux");

    expect(hop).toBe(
      "client=typescript-sdk;ver=1.0_cmd_evil_client_spoofed;plat=li_nux",
    );
    // Exactly one hop, with only the delimiters we rendered ourselves.
    expect(hop).not.toContain(",");
    expect(hop.match(/;/g)).toHaveLength(2);
  });

  it("bounds parameter length without exposing a trailing separator", () => {
    // The 63-character cut lands right after the `,` that sanitizing turned
    // into a `_`, so stripping separators before truncating is not enough --
    // the truncation itself can create a new trailing one.
    const hop = buildHop(`${"v".repeat(62)},rc1`, "linux");

    expect(hop).toBe(`client=typescript-sdk;ver=${"v".repeat(62)};plat=linux`);
  });
});

describe("clientHeaderValue", () => {
  it("is a single hop when the SDK originates the request", () => {
    const value = clientHeaderValue();

    expect(value).not.toContain(",");
    expect(value.startsWith(`client=${CLIENT_TOKEN};ver=`)).toBe(true);
  });

  it("appends its own hop to the right of an upstream chain", () => {
    const value = clientHeaderValue("client=studio-frontend", "client=x");

    // Leftmost hop stays the origin; ours is the rightmost, direct caller.
    expect(value).toBe("client=studio-frontend, client=x");
  });

  it("normalizes upstream spacing and drops empty hops", () => {
    const value = clientHeaderValue(
      "  client=cli;ver=1.2.0 ,, ,  client=mcp  ",
      "client=x",
    );

    expect(value).toBe("client=cli;ver=1.2.0, client=mcp, client=x");
  });

  it("preserves upstream hop parameters verbatim", () => {
    // The chain records what upstream asserted; it is not ours to re-render.
    const value = clientHeaderValue(
      "client=mcp;ver=0.9;cmd=run_query",
      "client=x",
    );

    expect(value).toBe("client=mcp;ver=0.9;cmd=run_query, client=x");
  });

  it("strips characters that would inject a header or corrupt the grammar", () => {
    const value = clientHeaderValue(
      'client=cli\r\nX-Evil: 1\ttab"quote"',
      "client=x",
    );

    expect(value).not.toMatch(/[\r\n\t"]/);
    expect(value.startsWith("client=cli_")).toBe(true);
  });

  it("drops the oldest upstream hops rather than blowing the size bound", () => {
    // An oversized value is malformed to the server, which then attributes the
    // whole request to `unknown` -- losing early provenance is the better half
    // of that trade.
    const oversized = Array.from(
      { length: 20 },
      (_, i) => `client=${String(i).repeat(40)}`,
    ).join(", ");
    expect(byteLength(oversized)).toBeGreaterThan(MAX_HEADER_BYTES);

    const value = clientHeaderValue(oversized, "client=x");

    expect(byteLength(value)).toBeLessThanOrEqual(MAX_HEADER_BYTES);
    // Our own hop always survives, and it stays rightmost.
    expect(value.endsWith("client=x")).toBe(true);
  });

  it("keeps our hop when even one upstream hop will not fit", () => {
    const value = clientHeaderValue(`client=${"x".repeat(600)}`, "client=x");

    expect(value).toBe("client=x");
  });

  it("sanitizes non-ASCII before measuring the bound", () => {
    const value = clientHeaderValue(`client=${"é".repeat(600)}`, "client=x");

    expect(byteLength(value)).toBeLessThanOrEqual(MAX_HEADER_BYTES);
    expect(value).toBe("client=x");
  });

  it("is always sendable as a real header value", () => {
    // `fetch` rejects an illegal header value outright, so a hostile chain
    // must never be able to break session creation.
    const value = clientHeaderValue(
      "client=evil\r\nX-Injected: yes, client=日本語",
    );

    expect(() => new Headers({ "X-Wherobots-Client": value })).not.toThrow();
    expect(
      new Headers({ "X-Wherobots-Client": value }).get("X-Wherobots-Client"),
    ).toBe(value);
  });
});
