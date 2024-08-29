# Wherobots TypesSript SDK

TypeScript SDK for interacting with Wherobots DB. This package implements a Node.js
client to programmatically connect to a Wherobots DB runtime and execute Spatial SQL queries.

:warning: WARNING: This package is currently in Alpha. It is not recommended for production use.
API interfaces may be subject to change.

## Prerequisites

1. Node.js version 18 or higher
1. TypeScript version 5.x (if using TypeScript)
1. A Wherobots API Key. See the [Wherobots API Key Documentation](https://docs.wherobots.com/latest/get-started/api-keys/)
   for instructions on how to generate a key.

## Installation

```
$ npm install wherobots
```

## Usage

### Executing an SQL statement and printing the results

Follows the typical pattern of an async function to establish the connection,
which provides async methods for executing SQL queries through it:

```ts
import { Connection, Runtime } from "wherobots";

(async () => {
  const conn = await Connection.connect({
    apiKey: "<api-key>",
    runtime: Runtime.SEDONA,
  });
  const results = await conn.execute("SHOW SCHEMAS IN wherobots_open_data");
  console.log(JSON.stringify(results.toArray(), null, 2));
  conn.close();
})();
```

Running this code will output the results of the query as JSON:

```
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
1. The Arrow Table instance can be converted to a primitive by calling `toArray()`, and then printed
   to the console as formatted JSON with `JSON.stringify()`.
1. Calling the connection's `close()` method tears down the SQL Session connection.

<details>
  <summary>Running the example - JavaScript</summary>

1. Paste the contents of the above code example into a file called `wherobots-example.js`
1. Run the example with: `node wherobots-example.js`
</details>

<details>
  <summary>Running the example - TypeScript</summary>

1. Paste the contents of the above code example into a file called `wherobots-example.ts`
1. Run the example with: `npx tsx wherobots-example.ts`
</details>

### Runtime and region selection

You can chose the Wherobots runtime you want to use using the `runtime`
parameter, passing in one of the `Runtime` enum values. For more
information on runtime sizing and selection, please consult the
[Wherobots product documentation](https://docs.wherobots.com).

### Additional parameters

The `Connection.connect()` function takes some additional options that
can be optionally specified:

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
  libraries like Shapely.

- `region`: The only supported Wherobots compute region for now is `aws-us-west-2`,
  in AWS's Oregon (`us-west-2`) region. In future, specifying a different region
  will be possible using the `Region` enum values.
