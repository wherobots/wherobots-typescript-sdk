/*
 * run with:

 *   `WHEROBOTS_API_KEY=<api key> node -r @swc-node/register examples/multiSessionConnections.ts`
 * 
 * or for verbose logging:
 * 
 *   `NODE_DEBUG="wherobots-sql-driver" WHEROBOTS_API_KEY=<api key> node -r @swc-node/register examples/multiSessionConnections.ts`
 */

import { Connection } from "@/connection";
import { Runtime, SessionType } from "@/constants";
import { Utf8 } from "apache-arrow";

const connectAndQuery = async () => {
  const conn = await Connection.connect({
    runtime: Runtime.TINY,
    sessionType: SessionType.MULTI,
  });
  await new Promise((resolve) =>
    setTimeout(resolve, Math.random() * 15 * 1000),
  );
  const results = await conn.execute<{ namespace: Utf8 }>(
    "SHOW SCHEMAS IN wherobots_open_data",
  );
  conn.close();
  return results.toArray();
};

const numConnections = 10;

(async () => {
  const results = await Promise.all(
    [...Array(numConnections).fill(undefined)].map(connectAndQuery),
  );
  console.log(results);
})();
