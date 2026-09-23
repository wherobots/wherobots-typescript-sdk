import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Drive } from "../constants";
import { Files } from "./files";
import {
  FileNotFoundError,
  FilesAuthenticationError,
  FilesError,
  FilesNotEnabledError,
} from "./errors";

const API = "https://api.test.wherobots.com";
const SID = "user_files%3A%3Aaws-us-west-2";
const BASE = `${API}/storage/${SID}`;
const SIGNED_GET = "https://bucket.s3.amazonaws.com/obj?X-Amz-Signature=get";
const SIGNED_PUT = "https://bucket.s3.amazonaws.com/obj?X-Amz-Signature=put";

type Call = { url: string; init: RequestInit };
type Handler = (url: string, init: RequestInit) => Response | undefined;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const errorBody = (status: number, detail: string) =>
  json({ errors: [{ detail }], requestId: "r" }, status);

// A fetch stub that records every call and answers from the first handler
// that returns a response; anything unhandled is a test failure.
const mockFetch = (...handlers: Handler[]) => {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const req = init ?? {};
    calls.push({ url, init: req });
    for (const h of handlers) {
      const res = h(url, req);
      if (res) return res;
    }
    throw new Error(`Unexpected request: ${req.method ?? "GET"} ${url}`);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
};

const on =
  (method: string, url: string | RegExp, res: () => Response): Handler =>
  (u, init) => {
    const m = init.method ?? "GET";
    const hit = typeof url === "string" ? u === url : url.test(u);
    return m === method && hit ? res() : undefined;
  };

const headersOf = (call: Call) =>
  new Headers(call.init.headers as HeadersInit | undefined);

const client = (f: typeof fetch, extra: object = {}) =>
  new Files(
    { apiKey: "secret-key", apiUrl: API, region: "aws-us-west-2", ...extra },
    { fetch: f },
  );

const entry = (name: string, type = "FILE") => ({
  name,
  path: name,
  type,
  size: 1,
  lastModified: null,
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Files client", () => {
  test("myFiles resolves to the user_files storage id for the region", async () => {
    const { fetch: f, calls } = mockFetch(
      on("GET", /\/directories\/\?limit=1000$/, () =>
        json({ items: [], path: "", name: "" }),
      ),
    );
    await client(f).myFiles.listAll();
    expect(calls[0]!.url).toBe(`${BASE}/directories/?limit=1000`);
  });

  test("drive() region overrides the client region", () => {
    const d = client(mockFetch().fetch).drive(Drive.MY_FILES, {
      region: "aws-eu-west-1",
    });
    expect(d.region).toBe("aws-eu-west-1");
    expect(d.drive).toBe(Drive.MY_FILES);
  });

  test("throws when no region is given", () => {
    const files = new Files(
      { apiKey: "k", apiUrl: API },
      { fetch: mockFetch().fetch },
    );
    expect(() => files.myFiles).toThrow(/region is required/);
  });

  test("requires exactly one credential", () => {
    expect(() => new Files({ apiKey: "k", token: "t" })).toThrow(/Exactly one/);
  });

  test("falls back to WHEROBOTS_API_KEY", async () => {
    vi.stubEnv("WHEROBOTS_API_KEY", "env-key");
    const { fetch: f, calls } = mockFetch(
      on("GET", /directories/, () => json({ items: [], path: "", name: "" })),
    );
    await new Files(
      { apiUrl: API, region: "r" },
      { fetch: f },
    ).myFiles.listAll();
    expect(headersOf(calls[0]!).get("X-API-Key")).toBe("env-key");
  });

  test("sends credentials and the client header to the API", async () => {
    const { fetch: f, calls } = mockFetch(
      on("GET", /directories/, () => json({ items: [], path: "", name: "" })),
    );
    await client(f, { apiKey: undefined, token: "tok" }).myFiles.listAll();
    const h = headersOf(calls[0]!);
    expect(h.get("Authorization")).toBe("Bearer tok");
    expect(h.get("X-Wherobots-Client")).toMatch(/client=typescript-sdk/);
  });

  test("lists the available drives", async () => {
    expect(await client(mockFetch().fetch).drives()).toEqual([
      { drive: Drive.MY_FILES, name: "My Files" },
    ]);
  });
});

describe("paths", () => {
  test("encodes each segment separately and never encodes '/'", async () => {
    const { fetch: f, calls } = mockFetch(
      on("DELETE", /\/files\//, () => new Response(null, { status: 204 })),
    );
    await client(f).myFiles.deleteFile("/my dir/a#b?c%d.txt");
    expect(calls[0]!.url).toBe(`${BASE}/files/my%20dir/a%23b%3Fc%25d.txt`);
  });

  test("deleteDirectory sends one trailing slash", async () => {
    const { fetch: f, calls } = mockFetch(
      on("DELETE", /directories/, () => new Response(null, { status: 204 })),
    );
    await client(f).myFiles.deleteDirectory("a/b/");
    expect(calls[0]!.url).toBe(`${BASE}/directories/a/b/`);
  });

  test("rename sends new_name as a query parameter", async () => {
    const { fetch: f, calls } = mockFetch(
      on("POST", /file-rename/, () => json({})),
    );
    await client(f).myFiles.rename("a/old.txt", "new name.txt");
    expect(calls[0]!.url).toBe(
      `${BASE}/file-rename/a/old.txt?new_name=new+name.txt`,
    );
  });
});

describe("list", () => {
  test("always sends an explicit limit and follows the cursor", async () => {
    const { fetch: f, calls } = mockFetch(
      on("GET", `${BASE}/directories/data/?limit=1000`, () =>
        json({ items: [entry("a")], path: "", name: "", next_page: "c1" }),
      ),
      on("GET", `${BASE}/directories/data/?limit=1000&cursor=c1`, () =>
        json({
          items: [entry("b", "FOLDER")],
          path: "",
          name: "",
          next_page: null,
        }),
      ),
    );
    const names: string[] = [];
    for await (const e of client(f).myFiles.list("data")) {
      names.push(e.name);
    }
    expect(names).toEqual(["a", "b"]);
    expect(calls).toHaveLength(2);
  });

  test("stops when the cursor does not move", async () => {
    const { fetch: f, calls } = mockFetch(
      on("GET", /directories/, () =>
        json({ items: [entry("a")], path: "", name: "", next_page: "same" }),
      ),
    );
    const all = await client(f).myFiles.listAll();
    expect(all).toHaveLength(2);
    expect(calls).toHaveLength(2);
  });
});

describe("makeDirectory", () => {
  test("creates each level in turn", async () => {
    const { fetch: f, calls } = mockFetch(
      on("PUT", /directories/, () => new Response(null, { status: 201 })),
    );
    await client(f).myFiles.makeDirectory("/a/b c/d/");
    expect(calls.map((c) => c.url)).toEqual([
      `${BASE}/directories/a/`,
      `${BASE}/directories/a/b%20c/`,
      `${BASE}/directories/a/b%20c/d/`,
    ]);
  });

  test("tolerates an existing parent but not an existing target", async () => {
    const { fetch: f } = mockFetch(
      on("PUT", `${BASE}/directories/a/`, () => errorBody(409, "exists")),
      on("PUT", `${BASE}/directories/a/b/`, () => errorBody(409, "exists")),
    );
    await expect(client(f).myFiles.makeDirectory("a/b")).rejects.toThrow(
      /HTTP 409/,
    );
  });

  test("refuses an empty level", async () => {
    await expect(
      client(mockFetch().fetch).myFiles.makeDirectory("a//b"),
    ).rejects.toBeInstanceOf(FilesError);
  });
});

describe("upload", () => {
  test("PUTs the bytes to the signed link with no Wherobots headers", async () => {
    const { fetch: f, calls } = mockFetch(
      on("POST", `${BASE}/file-upload-url/dir/x.bin`, () =>
        json({ destination: "s3://b/k", uploadUrl: SIGNED_PUT }),
      ),
      on("PUT", SIGNED_PUT, () => new Response(null, { status: 200 })),
    );
    await client(f).myFiles.upload("dir/x.bin", new Uint8Array([1, 2, 3]));
    const put = calls[1]!;
    expect(put.init.headers).toBeUndefined();
    expect(await new Response(put.init.body as Blob).arrayBuffer()).toEqual(
      new Uint8Array([1, 2, 3]).buffer,
    );
    expect(headersOf(calls[0]!).get("X-API-Key")).toBe("secret-key");
  });

  test("reads a local path in Node", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "files-test-"));
    const local = path.join(dir, "in.txt");
    fs.writeFileSync(local, "hello");
    const { fetch: f, calls } = mockFetch(
      on("POST", /file-upload-url/, () =>
        json({ destination: "s3://b/k", uploadUrl: SIGNED_PUT }),
      ),
      on("PUT", SIGNED_PUT, () => new Response(null, { status: 200 })),
    );
    await client(f).myFiles.upload("in.txt", local);
    expect(await new Response(calls[1]!.init.body as Blob).text()).toBe(
      "hello",
    );
  });

  test("a storage failure is a FilesError with its status", async () => {
    const { fetch: f } = mockFetch(
      on("POST", /file-upload-url/, () =>
        json({ destination: "s3://b/k", uploadUrl: SIGNED_PUT }),
      ),
      on("PUT", SIGNED_PUT, () => new Response("<Error/>", { status: 403 })),
    );
    await expect(
      client(f).myFiles.upload("a", new Blob(["x"])),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("download", () => {
  const redirect = () =>
    new Response(null, { status: 307, headers: { location: SIGNED_GET } });

  test("follows the redirect itself and sends nothing to the signed link", async () => {
    const { fetch: f, calls } = mockFetch(
      on("GET", `${BASE}/files/d/x.txt`, redirect),
      on("GET", SIGNED_GET, () => new Response("payload")),
    );
    const blob = await client(f).myFiles.download("d/x.txt");
    expect(await blob.text()).toBe("payload");
    expect(calls[0]!.init.redirect).toBe("manual");
    expect(calls[1]!.init.headers).toBeUndefined();
    expect(JSON.stringify(calls[1]!.init)).not.toContain("secret-key");
  });

  test("downloadTo streams the body to a local file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "files-test-"));
    const local = path.join(dir, "out.txt");
    const { fetch: f } = mockFetch(
      on("GET", /\/files\//, redirect),
      on("GET", SIGNED_GET, () => new Response("on disk")),
    );
    await client(f).myFiles.downloadTo("x.txt", local);
    expect(fs.readFileSync(local, "utf8")).toBe("on disk");
  });

  test("a storage failure is not mistaken for a missing file", async () => {
    const { fetch: f } = mockFetch(
      on("GET", /\/files\//, redirect),
      on("GET", SIGNED_GET, () => new Response("", { status: 404 })),
    );
    const err = await client(f)
      .myFiles.download("x")
      .catch((e) => e);
    expect(err).toBeInstanceOf(FilesError);
    expect(err).not.toBeInstanceOf(FileNotFoundError);
  });
});

describe("errors", () => {
  test("401 is an authentication error", async () => {
    const { fetch: f } = mockFetch(
      on("DELETE", /files/, () => errorBody(401, "bad key")),
    );
    const err = await client(f)
      .myFiles.deleteFile("x")
      .catch((e) => e);
    expect(err).toBeInstanceOf(FilesAuthenticationError);
    expect(err.message).toContain("bad key");
  });

  test("404 on a reachable drive is a missing file", async () => {
    const { fetch: f, calls } = mockFetch(
      on("DELETE", /files/, () => errorBody(404, "nope")),
      on("GET", `${BASE}/directories/?limit=1`, () =>
        json({ items: [], path: "", name: "" }),
      ),
    );
    const err = await client(f)
      .myFiles.deleteFile("gone.txt")
      .catch((e) => e);
    expect(err).toBeInstanceOf(FileNotFoundError);
    expect(err.path).toBe("gone.txt");
    expect(calls).toHaveLength(2);
  });

  test("404 when the drive root is unreachable names drive and region", async () => {
    const { fetch: f } = mockFetch(
      on("GET", /\/files\//, () => errorBody(404, "not found")),
      on("GET", /\/directories\//, () => errorBody(404, "not found")),
    );
    const err = await client(f)
      .myFiles.download("x")
      .catch((e) => e);
    expect(err).toBeInstanceOf(FilesNotEnabledError);
    expect(err.message).toContain('"my-files"');
    expect(err.message).toContain('"aws-us-west-2"');
  });

  test("404 on the root listing itself needs no second request", async () => {
    const { fetch: f, calls } = mockFetch(
      on("GET", /directories/, () => errorBody(404, "not found")),
    );
    await expect(client(f).myFiles.listAll()).rejects.toBeInstanceOf(
      FilesNotEnabledError,
    );
    expect(calls).toHaveLength(1);
  });

  test("other statuses carry the server's detail", async () => {
    const { fetch: f } = mockFetch(
      on("POST", /file-upload-url/, () =>
        errorBody(400, "An upload path must name a file, not a folder"),
      ),
    );
    const err = await client(f)
      .myFiles.upload("dir/", new Blob(["x"]))
      .catch((e) => e);
    expect(err).toBeInstanceOf(FilesError);
    expect(err.status).toBe(400);
    expect(err.message).toContain("must name a file");
  });
});
