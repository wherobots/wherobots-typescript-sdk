import { ApiErrorBodySchema } from "../schemas";

// Base class for every error a Files operation raises. `status` is the HTTP
// status that caused it, when there was one.
export class FilesError extends Error {
  public readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "FilesError";
    this.status = status;
  }
}

// Files is not turned on for this drive in this region (a feature flag).
export class FilesNotEnabledError extends FilesError {
  public readonly drive: string;
  public readonly region: string;

  constructor(drive: string, region: string) {
    super(
      `Files is not enabled for drive "${drive}" in region "${region}". Check the region, or ask your Wherobots administrator to enable Files there.`,
      404,
    );
    this.name = "FilesNotEnabledError";
    this.drive = drive;
    this.region = region;
  }
}

// The API key or token was missing, expired or not accepted (HTTP 401).
export class FilesAuthenticationError extends FilesError {
  constructor(detail?: string) {
    super(
      `The Wherobots credentials were not accepted${detail ? `: ${detail}` : ""}. Check the API key or token.`,
      401,
    );
    this.name = "FilesAuthenticationError";
  }
}

// The file or folder does not exist on a drive that is otherwise reachable.
export class FileNotFoundError extends FilesError {
  public readonly path: string;

  constructor(path: string) {
    super(`No such file or folder: "${path}"`, 404);
    this.name = "FileNotFoundError";
    this.path = path;
  }
}

// Pull a human-readable message out of an API error response, if it has one.
export const apiErrorDetail = async (
  res: Response,
): Promise<string | undefined> => {
  let body: unknown;
  try {
    body = await res.clone().json();
  } catch {
    return undefined;
  }
  const parsed = ApiErrorBodySchema.safeParse(body);
  if (!parsed.success) {
    return undefined;
  }
  const messages = (parsed.data.errors ?? [])
    .map((e) => e.detail ?? e.message ?? e.title)
    .filter((m): m is string => Boolean(m));
  if (messages.length > 0) {
    return messages.join("; ");
  }
  return typeof parsed.data.detail === "string"
    ? parsed.data.detail
    : undefined;
};
