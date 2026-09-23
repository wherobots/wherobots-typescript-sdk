import { Platform } from "../platform/types";
import {
  DirectoryListingSchema,
  FileEntry,
  UploadUrlResponseSchema,
} from "../schemas";
import { Drive } from "../constants";
import {
  apiErrorDetail,
  FileNotFoundError,
  FilesAuthenticationError,
  FilesError,
  FilesNotEnabledError,
} from "./errors";

// The server's hard ceiling; a larger value is a 500, and 0 means "no paging".
export const LIST_PAGE_LIMIT = 1000;

// Everything a drive needs; built once by `Files`, which owns the resolver.
export interface DriveContext {
  drive: Drive;
  region: string;
  storageId: string;
  apiUrl: string;
  headers: Record<string, string>;
  fetch: typeof fetch;
  platform: Platform;
}

// A local file path (Node only) or the bytes themselves.
export type UploadSource = string | Blob | ArrayBuffer | Uint8Array;

type Route = "directories" | "files" | "file-upload-url" | "file-rename";

const trimSlashes = (path: string) => path.replace(/^\/+|\/+$/g, "");

// Percent-encode each segment on its own so "/" stays a separator.
export const encodePath = (path: string): string =>
  path.split("/").map(encodeURIComponent).join("/");

// A directory path as the API spells it: no leading slash, one trailing
// slash, and the empty string for the drive root.
const directoryPath = (path: string): string => {
  const trimmed = trimSlashes(path);
  return trimmed ? `${trimmed}/` : "";
};

const toBlob = (source: Blob | ArrayBuffer | Uint8Array): Blob =>
  source instanceof Blob
    ? source
    : // BlobPart wants Uint8Array<ArrayBuffer>; ours may be ArrayBufferLike.
      new Blob([source as unknown as BlobPart]);

// One drive. Every file operation lives here, written once for every kind of
// drive; only the storage id in the context differs between drives.
export class FileDrive {
  public readonly drive: Drive;
  public readonly region: string;

  constructor(private readonly ctx: DriveContext) {
    this.drive = ctx.drive;
    this.region = ctx.region;
  }

  // Yields every entry of one folder, following the cursor page by page.
  public async *list(path = ""): AsyncGenerator<FileEntry, void, undefined> {
    const dir = directoryPath(path);
    let cursor: string | undefined;
    do {
      const params = new URLSearchParams({ limit: String(LIST_PAGE_LIMIT) });
      if (cursor) {
        params.set("cursor", cursor);
      }
      const res = await this.request("GET", "directories", dir, params);
      if (!res.ok) {
        await this.fail(res, dir, dir === "");
      }
      const page = DirectoryListingSchema.parse(await res.json());
      yield* page.items;
      const next = page.next_page ?? undefined;
      // A cursor that does not move would loop forever; treat it as the end.
      cursor = next && next !== cursor ? next : undefined;
    } while (cursor);
  }

  public async listAll(path = ""): Promise<FileEntry[]> {
    const entries: FileEntry[] = [];
    for await (const entry of this.list(path)) {
      entries.push(entry);
    }
    return entries;
  }

  // Creates each level of a nested path in turn: the server creates only the
  // deepest level, and implied parents would be owned by root on the mount.
  public async makeDirectory(path: string): Promise<void> {
    const segments = trimSlashes(path).split("/");
    if (segments.some((s) => s === "")) {
      throw new FilesError(
        `A directory path must name a folder and have no empty level: "${path}"`,
      );
    }
    for (let depth = 1; depth <= segments.length; depth++) {
      const level = `${segments.slice(0, depth).join("/")}/`;
      const res = await this.request("PUT", "directories", level);
      const isLast = depth === segments.length;
      // A parent that already exists is fine; only the target may conflict.
      if (!res.ok && !(res.status === 409 && !isLast)) {
        await this.fail(res, level);
      }
    }
  }

  // Uploads one file through a short-lived signed link. The PUT to storage
  // carries no Wherobots headers. A string source is a local path (Node).
  public async upload(remotePath: string, source: UploadSource): Promise<void> {
    const body =
      typeof source === "string"
        ? await this.ctx.platform.openLocalFile(source)
        : toBlob(source);
    const path = remotePath.replace(/^\/+/, "");
    const res = await this.request("POST", "file-upload-url", path);
    if (!res.ok) {
      await this.fail(res, path);
    }
    const { uploadUrl } = UploadUrlResponseSchema.parse(await res.json());
    const put = await this.ctx.fetch(uploadUrl, { method: "PUT", body });
    if (!put.ok) {
      throw new FilesError(
        `Upload of "${path}" to storage failed (HTTP ${put.status})`,
        put.status,
      );
    }
  }

  // Downloads one file into memory, as a Blob (Node and browser).
  public async download(remotePath: string): Promise<Blob> {
    const res = await this.openDownload(remotePath);
    return res.blob();
  }

  // Streams one file straight to a local path (Node only).
  public async downloadTo(
    remotePath: string,
    localPath: string,
  ): Promise<void> {
    const res = await this.openDownload(remotePath);
    if (!res.body) {
      throw new FilesError(`Download of "${remotePath}" returned no body`);
    }
    await this.ctx.platform.saveToFile(res.body, localPath);
  }

  // Renames a file in place; `newName` is a single name, not a path.
  public async rename(path: string, newName: string): Promise<void> {
    const filePath = path.replace(/^\/+/, "");
    const params = new URLSearchParams({ new_name: newName });
    const res = await this.request("POST", "file-rename", filePath, params);
    if (!res.ok) {
      await this.fail(res, filePath);
    }
  }

  public async deleteFile(path: string): Promise<void> {
    const filePath = path.replace(/^\/+/, "");
    const res = await this.request("DELETE", "files", filePath);
    if (!res.ok) {
      await this.fail(res, filePath);
    }
  }

  // Deletes a folder and everything in it.
  public async deleteDirectory(path: string): Promise<void> {
    const dir = directoryPath(path);
    const res = await this.request("DELETE", "directories", dir);
    if (!res.ok) {
      await this.fail(res, dir);
    }
  }

  private url(route: Route, path: string, params?: URLSearchParams): string {
    const query = params ? `?${params.toString()}` : "";
    return `${this.ctx.apiUrl}/storage/${encodeURIComponent(
      this.ctx.storageId,
    )}/${route}/${encodePath(path)}${query}`;
  }

  private request(
    method: string,
    route: Route,
    path: string,
    params?: URLSearchParams,
  ): Promise<Response> {
    return this.ctx.fetch(this.url(route, path, params), {
      method,
      headers: this.ctx.headers,
      cache: "no-store",
    });
  }

  private async openDownload(remotePath: string): Promise<Response> {
    const path = remotePath.replace(/^\/+/, "");
    const { response, fromStorage } = await this.ctx.platform.fetchDownload(
      this.ctx.fetch,
      this.url("files", path),
      this.ctx.headers,
    );
    if (response.ok) {
      return response;
    }
    if (fromStorage) {
      throw new FilesError(
        `Download of "${path}" from storage failed (HTTP ${response.status})`,
        response.status,
      );
    }
    return this.fail(response, path);
  }

  // Turns a failed API response into the error the user can act on. A 404 is
  // ambiguous, so one listing of the drive root decides: it fails only when
  // Files is off for this drive and region.
  private async fail(
    res: Response,
    path: string,
    isRootListing = false,
  ): Promise<never> {
    const detail = await apiErrorDetail(res);
    if (res.status === 401) {
      throw new FilesAuthenticationError(detail);
    }
    if (res.status === 404) {
      if (isRootListing || !(await this.driveReachable())) {
        throw new FilesNotEnabledError(this.drive, this.region);
      }
      throw new FileNotFoundError(path);
    }
    throw new FilesError(
      `Files request for "${path}" failed (HTTP ${res.status})${
        detail ? `: ${detail}` : ""
      }`,
      res.status,
    );
  }

  private async driveReachable(): Promise<boolean> {
    const params = new URLSearchParams({ limit: "1" });
    const res = await this.request("GET", "directories", "", params);
    return res.status !== 404;
  }
}
