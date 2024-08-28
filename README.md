# wherobots-typescript-sdk

Typescript SDK for interacting with Wherobots DB. This package implements a Node.js
client to programmatically connect to a Wherobots DB runtime and execute Spatial SQL queries.

## Installation

```
$ npm install wherobots
```

## Usage

### Basic usage

Basic usage follows the typical pattern of an async function to
establish the connection, which provides async methods for
executing SQL queries through it:

```ts
import { Connection, Runtime } from "wherobots";

(async () => {
  const conn = await Connection.connect({
    apiKey: "...",
    runtime: Runtime.SEDONA,
  });
  const results = await conn.execute("SHOW SCHEMAS IN wherobots_open_data");
  console.log(results);
  conn.close();
})();
```

### Runtime and region selection

You can chose the Wherobots runtime you want to use using the `runtime`
parameter, passing in one of the `Runtime` enum values. For more
information on runtime sizing and selection, please consult the
[Wherobots product documentation](https://docs.wherobots.com).

The only supported Wherobots compute region for now is `aws-us-west-2`,
in AWS's Oregon (`us-west-2`) region.

### Advanced parameters

The `connect()` method takes some additional parameters that advanced
users may find useful:

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
  - NOTE: currently only EWKT representation is supported
