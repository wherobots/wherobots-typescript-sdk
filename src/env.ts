import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    WHEROBOTS_API_URI: z.string().url().optional(),
    WHEROBOTS_API_KEY: z.string().min(1).optional(),
  },

  runtimeEnv: {
    WHEROBOTS_API_URI: process.env["WHEROBOTS_API_URI"],
    WHEROBOTS_API_KEY: process.env["WHEROBOTS_API_KEY"],
  },
  emptyStringAsUndefined: true,
});
