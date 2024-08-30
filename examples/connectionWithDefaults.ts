/*
 * run with:

 *   `WHEROBOTS_API_KEY=<api key> node -r @swc-node/register examples/connectionWithDefaults.ts`
 * 
 * or for verbose logging:
 * 
 *   `NODE_DEBUG="wherobots-sql-driver" WHEROBOTS_API_KEY=<api key> node -r @swc-node/register examples/connectionWithDefaults.ts`
 */

import { Connection, Runtime } from "@/index";
import { Utf8 } from "apache-arrow";

(async () => {
  const conn = await Connection.connect({
    apiKey:
      process.env["WHEROBOTS_API_KEY"] ||
      "00000000-0000-0000-0000-000000000000",
    runtime: Runtime.SEDONA,
  });
  const results = await conn.execute<{ namespace: Utf8 }>(
    "SHOW SCHEMAS IN wherobots_open_data",
  );
  console.log(results.toArray());
  setTimeout(() => conn.close(), 5000);
})();
