// Build the advisory `X-Wherobots-Client` request header.
//
// `X-Wherobots-Client` is the shared, cross-client attribution header. It
// carries an ordered, comma-separated chain of hops modelled on
// `X-Forwarded-For`: the *leftmost* hop is the origin client and every
// component that forwards the request *appends its own hop on the right*:
//
//     client=studio-frontend, client=typescript-sdk;ver=0.11.1;plat=browser
//
// Each hop is `client=<token>` plus optional `;key=value` parameters. The
// convention defines `ver`, `plat` and `cmd`; this SDK emits `ver` and `plat` —
// there is no subcommand for it to name. Commas and semicolons are the
// delimiters, so they never appear inside a value, and neither do control
// characters, which an HTTP header field-value cannot carry at all.
//
// The header is *advisory only*: it is client-asserted, used for attribution
// and analytics, and must never influence authentication or authorization.
//
// See studio-backend `docs/client-attribution.md` — that document is the
// contract this module implements.

import { platform } from "@platform";
import { PACKAGE_VERSION } from "./version";

// Canonical name of the shared, cross-service client-chain header.
export const CLIENT_HEADER_NAME = "X-Wherobots-Client";

// This SDK's stable token in the shared client vocabulary. Renaming it splits
// its analytics history, so it never changes.
export const CLIENT_TOKEN = "typescript-sdk";

// The server treats a header value longer than this (in bytes) as malformed and
// records `unknown` for the whole chain, so we never emit more: oversized
// upstream chains are trimmed from the left instead. Every value is scrubbed to
// ASCII, so bytes and characters count the same here.
export const MAX_HEADER_BYTES = 512;

// Bounds a single parameter value (`ver`, `plat`). The server's 64-character
// limit applies to a hop's `client` token, not to its parameters, so an
// over-length value here costs nothing on its own; the bound exists so one
// pathological version string cannot eat the header budget and starve upstream
// hops. `CLIENT_TOKEN` is a short fixed literal and never passes through
// `sanitizeValue`.
const MAX_VALUE_CHARS = 63;

const HOP_SEPARATOR = ", ";
const REPLACEMENT = "_";

// Everything outside this ASCII allowlist collapses to `_`: the `,` and `;`
// grammar delimiters, every C0 control character and DEL (a CR or LF here is
// the classic header-injection primitive, and `fetch` rejects the request
// outright rather than sending it), and every non-ASCII character.
const UNSAFE_VALUE_CHARS = /[^A-Za-z0-9._+-]/g;

// An upstream chain carries its own `,` / `;` / `=` grammar, so those survive;
// everything else outside the allowlist does not.
const UNSAFE_CHAIN_CHARS = /[^A-Za-z0-9._+:/@=;, -]/g;

// Render a value safe to embed in a hop we build ourselves.
const sanitizeValue = (value: string): string =>
  value
    .trim()
    .replace(UNSAFE_VALUE_CHARS, REPLACEMENT)
    .slice(0, MAX_VALUE_CHARS)
    // Trailing separators carry no information and read as noise. Stripped
    // after truncation as well as before it: the cut can land immediately
    // after a replaced character and expose a separator that was in the
    // middle of the value a moment ago.
    .replace(/^[_.-]+|[_.-]+$/g, "");

// The `plat` parameter for this hop. Node reports its OS (`darwin`, `linux`,
// `win32`) to match what the Python SDK and JDBC driver emit; the browser has
// no equivalent it can report honestly, and a UA-string parse would be a guess,
// so it reports the runtime instead. Resolved through the platform layer so
// that `process.platform` stays out of the browser bundle entirely.
export const resolvePlatform = (): string => platform.clientPlatform;

// Render this SDK's single hop. A parameter whose value is missing or empty is
// omitted rather than emitted as a placeholder, so an unresolvable version
// simply means the hop carries no `ver` — the `client=` token, which is the
// part attribution actually depends on, is always present.
export const buildHop = (
  version: string = PACKAGE_VERSION,
  platformName: string = resolvePlatform(),
): string => {
  const segments = [`client=${CLIENT_TOKEN}`];
  const sanitizedVersion = sanitizeValue(version);
  if (sanitizedVersion) {
    segments.push(`ver=${sanitizedVersion}`);
  }
  const sanitizedPlatform = sanitizeValue(platformName);
  if (sanitizedPlatform) {
    segments.push(`plat=${sanitizedPlatform}`);
  }
  return segments.join(";");
};

// Split an inbound chain into its individual hops. Hop *parameters* are
// preserved as-is — the chain is a record of what upstream asserted, not
// something to re-render — but the text is scrubbed, because an upstream chain
// is arbitrary caller-supplied input and this is the only sanitization it ever
// gets before landing in a request header.
const splitChain = (chain: string | undefined): string[] => {
  if (!chain) {
    return [];
  }
  return chain
    .replace(UNSAFE_CHAIN_CHARS, REPLACEMENT)
    .split(",")
    .map((hop) => hop.replace(/\s+/g, " ").trim())
    .filter((hop) => hop.length > 0);
};

const byteLength = (value: string): number =>
  new TextEncoder().encode(value).length;

// Build the full header value for a request this SDK is sending.
//
// Any `upstreamChain` the caller supplies is preserved — scrubbed, but
// otherwise untouched — and this SDK's hop is appended on its right, so the
// origin stays leftmost. When the result would exceed `MAX_HEADER_BYTES` the
// oldest (leftmost) upstream hops are dropped until it fits: losing early
// provenance beats the server discarding the whole chain as malformed.
//
// Never returns an empty string. With no upstream chain it is this SDK's
// single hop.
export const clientHeaderValue = (
  upstreamChain?: string,
  hop: string = buildHop(),
): string => {
  const hops = splitChain(upstreamChain);
  while (hops.length > 0) {
    const value = [...hops, hop].join(HOP_SEPARATOR);
    if (byteLength(value) <= MAX_HEADER_BYTES) {
      return value;
    }
    hops.shift();
  }
  return hop;
};
