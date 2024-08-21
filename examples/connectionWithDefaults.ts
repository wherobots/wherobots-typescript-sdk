// run with: node -r @swc-node/register examples/connectionWithDefaults.ts

import { Connection, Runtime } from "@/index";

const conn = new Connection({
  apiKey: "00000000-0000-0000-0000-000000000000",
  runtime: Runtime.SEDONA,
});

setTimeout(() => conn.close(), 5000);
