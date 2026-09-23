// REST setup shared by every client of the Wherobots API (SQL sessions and
// Files): the API origin, the credential headers and the attribution headers.
import { platform } from "@platform";
import { getEnv } from "./platform/env";
import { CLIENT_HEADER_NAME, clientHeaderValue } from "./clientHeader";
import { AuthCredentials } from "./platform/types";

export const DEFAULT_API_URL = "https://api.cloud.wherobots.com";

// The explicit option wins, then WHEROBOTS_API_URL (Node only), then prod.
export const resolveApiUrl = (apiUrl: string | undefined): string =>
  apiUrl || getEnv("WHEROBOTS_API_URL") || DEFAULT_API_URL;

// Apply the WHEROBOTS_API_KEY env fallback (Node only) only when the caller
// supplied neither an explicit apiKey nor a token, so passing a token never
// collides with an ambient API key.
export const withEnvApiKey = <T extends AuthCredentials>(options: T): T => {
  const merged: T = { ...options };
  if (!merged.apiKey && !merged.token) {
    const envApiKey = getEnv("WHEROBOTS_API_KEY");
    if (envApiKey) {
      merged.apiKey = envApiKey;
    }
  }
  return merged;
};

// The credential header for one request: a bearer token wins over an API key.
export const authHeaders = (auth: AuthCredentials): Record<string, string> => {
  if (auth.token) {
    return { Authorization: `Bearer ${auth.token}` };
  }
  if (auth.apiKey) {
    return { "X-API-Key": auth.apiKey };
  }
  return {};
};

export type RestHeaderOptions = AuthCredentials & {
  clientChain?: string | undefined;
};

export const buildRestHeaders = (
  options: RestHeaderOptions,
): Record<string, string> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    // Identifies the SDK on both platforms; a custom header is used because
    // browsers drop a JS-set User-Agent. The richer User-Agent below is
    // added only where the runtime allows it (Node).
    [CLIENT_HEADER_NAME]: clientHeaderValue(options.clientChain),
    ...authHeaders(options),
  };
  const userAgent = platform.userAgent();
  if (userAgent) {
    headers["User-Agent"] = userAgent;
  }
  return headers;
};
