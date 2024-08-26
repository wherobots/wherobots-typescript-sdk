import z, { ZodRawShape } from "zod";
import { SessionReponse } from "@/schemas.js";
import { SessionStatus } from "@/constants.js";
import logger from "@/logger.js";

export const parseResponse = async <T extends z.ZodObject<ZodRawShape>>(
  res: Response,
  schema: T,
): Promise<z.infer<T>> => {
  if (!res.ok) {
    logger
      .child({ status: res.status, url: res.url })
      .error(`Request failed: ${res.statusText}`);
    throw new Error(`Request failed: ${res.statusText}`);
  }
  const parseResult = schema.safeParse(await res.clone().json());
  if (!parseResult.success) {
    logger
      .child({ url: res.url, message: parseResult.error.message })
      .error("Invalid API response");
    logger.debug(parseResult.error);
    throw new Error("Invalid API response");
  }
  return parseResult.data;
};

export const isSessionInFinalState = (session: SessionReponse): boolean =>
  ![
    SessionStatus.PENDING,
    SessionStatus.PREPARING,
    SessionStatus.REQUESTED,
    SessionStatus.DEPLOYING,
    SessionStatus.DEPLOYED,
    SessionStatus.INITIALIZING,
  ].includes(session.status);

// choose a random number between 50% and 100% of the target delay
const jitter = (delay: number) => delay / 2 + (delay / 2) * Math.random();

// helper function to define the retry delay (in milliseconds)
// as a function of how many attempts have been made
export const backoffRetry = (attempts: number) => {
  if (attempts <= 1) {
    return jitter(1000);
  }
  if (attempts === 2) {
    return jitter(2000);
  }
  return jitter(5000);
};
