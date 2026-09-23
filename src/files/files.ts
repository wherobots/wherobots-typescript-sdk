import { platform as defaultPlatform } from "@platform";
import { Drive } from "../constants";
import { Platform } from "../platform/types";
import { FilesOptions, FilesOptionsSchemaNormalized } from "../schemas";
import { buildRestHeaders, resolveApiUrl, withEnvApiKey } from "../rest";
import { FileDrive } from "./drive";

export type FilesTestHarness = {
  fetch?: typeof fetch;
  platform?: Platform;
};

export type DriveOptions = {
  // Overrides the region given to `new Files()`.
  region?: string;
};

export type DriveInfo = {
  drive: Drive;
  name: string;
};

const DRIVE_NAMES: Record<Drive, string> = {
  [Drive.MY_FILES]: "My Files",
};

// The one place a drive becomes a storage id. A shared drive adds a case here.
export const storageIdFor = (drive: Drive, region: string): string => {
  switch (drive) {
    case Drive.MY_FILES:
      return `user_files::${region}`;
    default:
      throw new Error(`Unknown drive: ${String(drive)}`);
  }
};

// Entry point to Files, the personal file area also shown in Studio. It holds
// credentials and the API address only; it opens no SQL session.
export class Files {
  private readonly apiUrl: string;
  private readonly headers: Record<string, string>;
  private readonly region: string | undefined;
  private readonly fetch: typeof fetch;
  private readonly platform: Platform;

  constructor(options: FilesOptions, testHarness?: FilesTestHarness) {
    const parsed = FilesOptionsSchemaNormalized.parse(withEnvApiKey(options));
    this.platform = testHarness?.platform ?? defaultPlatform;
    // Same rule as Connection: in the browser, only a bearer token is allowed.
    if (parsed.apiKey && this.platform.clientPlatform === "browser") {
      throw new Error(
        "apiKey auth is not supported in the browser; pass `token` instead",
      );
    }
    this.apiUrl = resolveApiUrl(parsed.apiUrl);
    this.headers = buildRestHeaders(parsed);
    this.region = parsed.region;
    // The global fetch must be called bound to the global object in browsers.
    this.fetch = testHarness?.fetch ?? fetch.bind(globalThis);
  }

  public drive(drive: Drive, options: DriveOptions = {}): FileDrive {
    const region = options.region ?? this.region;
    if (!region) {
      throw new Error(
        `A region is required for drive "${drive}": pass \`region\` to \`new Files()\` or to \`files.drive()\``,
      );
    }
    return new FileDrive({
      drive,
      region,
      storageId: storageIdFor(drive, region),
      apiUrl: this.apiUrl,
      headers: this.headers,
      fetch: this.fetch,
      platform: this.platform,
    });
  }

  // My Files in the region given to `new Files()`.
  public get myFiles(): FileDrive {
    return this.drive(Drive.MY_FILES);
  }

  // The kinds of drive available. Async so a shared-drive lookup fits later.
  public async drives(): Promise<DriveInfo[]> {
    return [{ drive: Drive.MY_FILES, name: DRIVE_NAMES[Drive.MY_FILES] }];
  }
}
