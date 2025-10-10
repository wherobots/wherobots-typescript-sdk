# Wherobots TypeScript SDK

<!-- Note to authors: This content is duplicated from https://github.com/wherobots/documents/blob/source/docs/develop/spatial-sql-api.md#wherobots-sql-driver-typescript-sdk. When making updates here, please mirror them to the other location. -->

This is the TypeScript SDK for interacting with WherobotsDB. This package implements a Node.js
client that programmatically connects to a WherobotsDB runtime and executes Spatial SQL queries.

## Prerequisites

The following resources are needed to run the Wherobots SQL Driver's TypeScript SDK:

1. Node.js version 18 or higher
1. TypeScript version 5.x (if using TypeScript)
1. A Wherobots API Key. See the [Wherobots API Key Documentation](https://docs.wherobots.com/latest/get-started/api-keys/)
   for instructions on how to generate a key.

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

### Runtime and region selection

Select your desired Wherobots runtime using the runtime parameter and specifying a runtime enum value.
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

- `shutdownAfterInactiveSeconds`: a positive integer specifying the number of
  seconds of inactivity before the SQL session is automatically shut down
  (optional). This parameter allows for better resource management and cost
  control by automatically terminating idle sessions.

- `resultsFormat`: one of the `ResultsFormat` enum values;
  Arrow encoding is the default and most efficient format for
  receiving query results.

  - NOTE: currently only Arrow encoding is supported

- `dataCompression`: one of the `DataCompression` enum values; Brotli
  compression is the default and the most efficient compression
  algorithm for receiving query results.

  - NOTE: currently only Brotli compression is supported

- `geometryRepresentation`: one of the `GeometryRepresentation` enum
  values; selects the encoding of geometry columns returned to the
  client application. The default is EWKT (string) and the most
  convenient for human inspection while still being usable by
  geospatial data manipulation libraries.

- `region`: You must also specify in which region your SQL session should execute
  into. Wherobots Cloud supports the following compute regions:
  - `aws-us-east-1`: AWS US East 1 (N. Virginia)
  - `aws-us-west-2`: AWS US West 2 (Oregon)
  - `aws-eu-west-1`: AWS EU West 1 (Ireland)

> [!IMPORTANT]
> The `aws-us-west-2` region is available to all Wherobots Cloud users
> and customers; other regions are currently reserved to Professional
> Edition customers.

### Additional parameters to `execute()`

The `Connection#execute` method can take an optional second argument, `options`:

- `options.signal`: an `AbortSignal` which can be used to cancel the execution (optional)
