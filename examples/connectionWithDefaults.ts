/*
 * run with:

 *   `WHEROBOTS_API_KEY=<api key> node -r @swc-node/register examples/connectionWithDefaults.ts`
 * 
 * or for verbose logging:
 * 
 *   `NODE_DEBUG="wherobots" WHEROBOTS_API_KEY=<api key> node -r @swc-node/register examples/connectionWithDefaults.ts`
 */

import { Connection, Runtime } from "@/index";

const conn = new Connection({
  apiKey:
    process.env["WHEROBOTS_API_KEY"] || "00000000-0000-0000-0000-000000000000",
  runtime: Runtime.SEDONA,
});

setTimeout(() => conn.close(), 5000);
