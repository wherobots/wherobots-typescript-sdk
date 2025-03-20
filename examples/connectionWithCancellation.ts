/*
 * run with:

 *   `WHEROBOTS_API_KEY=<api key> npx tsx examples/connectionWithCancellation.ts`
 * 
 * or for verbose logging:
 * 
 *   `NODE_DEBUG="wherobots-sql-driver" WHEROBOTS_API_KEY=<api key> npx tsx examples/connectionWithCancellation.ts`
 */

import { Connection, Runtime } from "@/index";
import { Utf8 } from "apache-arrow";

(async () => {
  const conn = await Connection.connect({
    runtime: Runtime.TINY,
  });
  await new Promise((resolve) => setTimeout(resolve, 15 * 1000));
  const abortController = new AbortController();
  conn
    .execute<{ namespace: Utf8 }>("SHOW SCHEMAS IN wherobots_open_data", {
      signal: abortController.signal,
    })
    .catch((e) => {
      console.log("caught error", e);
    });
  setTimeout(() => abortController.abort(), 100);
  setTimeout(() => conn.close(), 5000);
})();
