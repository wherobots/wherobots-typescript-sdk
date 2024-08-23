import pino from "pino";
import { SessionReponse } from "./schemas";

const shouldUseDebugLogging = (process.env["NODE_DEBUG"] || "")
  .split(",")
  .includes("wherobots");

const logger = pino({
  name: "wherobots",
  level: shouldUseDebugLogging ? "debug" : "info",
  transport: {
    target: "pino-pretty",
  },
});

export default logger;

export const sessionContextLogger = (
  session: SessionReponse,
): typeof logger => {
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
