import { platform } from "@platform";
import { Logger } from "./platform/types";
import { SessionReponse } from "./schemas";

const shouldUseDebugLogging = (platform.getEnv("NODE_DEBUG") || "")
  .split(",")
  .includes("wherobots-sql-driver");

const logger: Logger = platform.createLogger({
  name: "wherobots-sql-driver",
  debug: shouldUseDebugLogging,
  enabled: platform.getEnv("NODE_ENV") !== "test",
});

export default logger;

export const sessionContextLogger = (session: SessionReponse): Logger => {
  const { id, status, traces, message, appMeta } = session;
  const context = Object.fromEntries(
    Object.entries({
      id,
      status,
      traces,
      message,
      appMeta,
    }).filter(([, val]) => Boolean(val)),
  );
  return logger.child(context);
};
