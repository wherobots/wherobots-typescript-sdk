# Wherobots TypeScript SDK

<!-- Note to authors: This content is duplicated from https://github.com/wherobots/documents/blob/source/docs/develop/spatial-sql-api.md#wherobots-sql-driver-typescript-sdk. When making updates here, please mirror them to the other location. -->

This is the TypeScript SDK for interacting with WherobotsDB. This package implements a
client that programmatically connects to a WherobotsDB runtime and executes Spatial SQL
queries. It runs in both **Node.js (18+)** and **modern browsers** from a single package — the
correct build is selected automatically via the package's `exports` conditions.

## Prerequisites

The following resources are needed to run the Wherobots SQL Driver's TypeScript SDK:

1. Node.js version 18 or higher, or a modern browser (Chromium/Firefox/Safari 16.4+)
1. TypeScript version 5.x (if using TypeScript)
1. Credentials — either:
   - A Wherobots API Key (see the [Wherobots API Key Documentation](https://docs.wherobots.com/latest/get-started/api-keys/)), or
   - A bearer token (e.g. a session access token), passed as `token`.

## Installation

To complete the installation, run the following command:

```bash
npm install wherobots-sql-driver
```

## Usage

### Example: Executing SQL statement and printing results

This example:

- Establishes the connection to WherobotsDB with an `async` function
- Calls `async` methods to execute SQL queries through this connection.

```ts
import { Connection, Runtime } from "wherobots-sql-driver";

(async () => {
  const conn = await Connection.connect({
    // replace "YOUR-WHEROBOTS-API-KEY" with the key created above
    // or alternatively the key can be set with the `WHEROBOTS_API_KEY` environment variable
    apiKey: "YOUR-WHEROBOTS-API-KEY",
    runtime: Runtime.SEDONA,
  });
  const results = await conn.execute("SHOW SCHEMAS IN wherobots_open_data");
  console.log(JSON.stringify(results.toArray(), null, 2));
  conn.close();
})();
```

Running this example returns the results of the query as JSON:

```json
[
  {
    "namespace": "overture"
  },
  {
    "namespace": "overture_2024_02_15"
  },
  {
    "namespace": "overture_2024_05_16"
  },
  {
    "namespace": "overture_2024_07_22"
  },
  {
    "namespace": "test_db"
  }
]
```

#### Code example explanation

1. Calling `Connection.connect()` asynchronously establishes a SQL Session connection
   in Wherobots Cloud and returns a `Connection` instance.
1. Calling the connection's `execute()` methods runs the given SQL statement and
   asynchronously returns the result as an [Apache Arrow Table](https://arrow.apache.org/docs/js/classes/Arrow_dom.Table.html) instance.
1. The Arrow Table instance is converted to a primitive by calling `toArray()`, and then printed
   to the console as formatted JSON with `JSON.stringify()`.
1. Calling the connection's `close()` method tears down the SQL Session connection.

##### Running the example - JavaScript

1. Paste the contents of the above code example into a file called `wherobots-example.js`
1. Run the example with: `node wherobots-example.js`

##### Running the example - TypeScript

1. Paste the contents of the above code example into a file called `wherobots-example.ts`
1. Run the example with: `npx tsx wherobots-example.ts`

### Authentication

Provide **exactly one** of:

- `apiKey`: a Wherobots API key. **Node only** — the browser cannot
  authenticate a WebSocket with an API key, so passing `apiKey` in the browser
  throws at connect time. In Node it also falls back to the
  `WHEROBOTS_API_KEY` environment variable when neither `apiKey` nor `token`
  is passed.
- `token`: a bearer token (e.g. a WorkOS access token). Sent as
  `Authorization: Bearer <token>` on the REST session calls.

```ts
const conn = await Connection.connect({ token: "YOUR-BEARER-TOKEN" });
```

### Browser usage

The SDK runs unchanged in the browser. Two environment differences are handled
automatically:

- **WebSocket authentication.** Browsers cannot set headers on a WebSocket, so
  the session socket authenticates via the `wherobotsToken` cookie, which the
  browser sends when its domain, path, and browser cookie policies permit it
  for the session host. The hosting app must establish this cookie separately
  through its login flow. Passing `token` authenticates REST calls; the SDK
  does not create the cookie. The SDK no longer sends API keys through the
  `?token=` query parameter, so passing `apiKey` in the browser throws at
  connect time.

  REST calls send `Authorization: Bearer <token>` in all environments;
  `X-API-Key` exists only on the Node `apiKey` path.

- **Compression.** Browsers have no brotli support, so the browser build
  requests and decodes **gzip** results (via the native `DecompressionStream`),
  while Node uses brotli. Override with `dataCompression` if needed.

In the browser, environment variables are unavailable, so pass `apiUrl`
explicitly if you need to target a non-default API origin.

### Runtime and region selection

Both `runtime` and `region` are optional and accept either a `Runtime`/`Region`
enum value (handy for autocomplete) or a plain string. Strings are passed to the
API as-is, so new or BYOC regions (e.g. `region: "byoc-acme-us-east-1"`) work
without an SDK upgrade. **When omitted, your organization's configured default
runtime and region are used** — only set them to override that default with a
specific runtime/region.

See the [Wherobots product documentation](https://docs.wherobots.com) for guidance on runtime sizing and selection.

### Additional parameters to `connect()`

The `Connection.connect()` function can take the following additional options:

- `sessionType`: `"single"` or `"multi"`; if set to `"single"`, then each call
  to `Connection.connect()` establishes an exclusive connection to a
  Wherobots runtime; if set to "multi", then multiple `Connection.connect()`
  calls with the same arguments and credentials will connect to the same
  shared Wherobots runtime; `"single"` is the default.

  Consider multi-session for potential cost savings, but be mindful of performance
  impacts from shared resources. You might need to adjust cluster size if slowdowns
  occur, which could affect overall cost.

- `force_new`: passing `force_new: true` forces Wherobots Cloud to create
  and start a new SQL Session runtime for this connection instead of
  attempting to reuse an existing, available one. Note that this can
  severely impact the delay in obtaining a connection to your runtime.

- `shutdownAfterInactiveSeconds`: a positive integer specifying the number of
  seconds of inactivity before the SQL session is automatically shut down
  (optional). This parameter allows for better resource management and cost
  control by automatically terminating idle sessions.

- `clientChain`: an inbound `X-Wherobots-Client` value to forward (optional).
  The SDK always identifies itself to Wherobots with an advisory
  `X-Wherobots-Client` attribution header. Set this only if your application is
  itself acting on behalf of an upstream Wherobots client: the value you pass is
  kept to the left of the SDK's own hop, so the original caller stays
  identifiable. The header is used for analytics only and never affects
  authentication, authorization, or quotas.

- `resultsFormat`: one of the `ResultsFormat` enum values;
  Arrow encoding is the default and most efficient format for
  receiving query results.

  - NOTE: currently only Arrow encoding is supported

- `dataCompression`: one of the `DataCompression` enum values
  (`brotli`, `gzip`, or `none`) for receiving query results. When omitted, the
  platform default is used: **brotli** in Node (most efficient) and **gzip** in
  the browser (the only algorithm browsers can natively decompress).

- `geometryRepresentation`: one of the `GeometryRepresentation` enum
  values; selects the encoding of geometry columns returned to the
  client application. The default is EWKT (string) and the most
  convenient for human inspection while still being usable by
  geospatial data manipulation libraries.

- `region`: the region your SQL session should execute in. Optional — when
  omitted, your organization's configured default region is used. Accepts a
  `Region` enum value or any string (BYOC regions included). Wherobots Cloud's
  built-in compute regions are:
  - `aws-us-east-1`: AWS US East 1 (N. Virginia)
  - `aws-us-east-2`: AWS US East 2 (Ohio)
  - `aws-us-west-2`: AWS US West 2 (Oregon)
  - `aws-eu-west-1`: AWS EU West 1 (Ireland)
  - `aws-ap-south-1`: AWS AP South 1 (Mumbai)

> [!IMPORTANT]
> The `aws-us-west-2` region is available to all Wherobots Cloud users
> and customers; other regions are currently reserved to Professional
> Edition customers.

### Additional parameters to `execute()`

The `Connection#execute` method can take an optional second argument, `options`:

- `options.signal`: an `AbortSignal` which can be used to cancel the execution (optional)
