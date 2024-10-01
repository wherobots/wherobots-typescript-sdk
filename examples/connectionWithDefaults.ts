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
    runtime: Runtime.SEDONA,
  });
  await new Promise((resolve) => setTimeout(resolve, 15 * 1000));
  const results = await conn.execute<{ namespace: Utf8 }>(
    "SHOW SCHEMAS IN wherobots_open_data",
  );
  console.log(results.toArray());
  setTimeout(() => conn.close(), 5000);
})();
