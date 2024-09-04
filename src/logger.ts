import pino from "pino";
import pinoPretty from "pino-pretty";
import { SessionReponse } from "./schemas";

const shouldUseDebugLogging = (process.env["NODE_DEBUG"] || "")
  .split(",")
  .includes("wherobots-sql-driver");

const logger = pino(
  {
    name: "wherobots-sql-driver",
    level: shouldUseDebugLogging ? "debug" : "info",
    enabled: process.env["NODE_ENV"] !== "test",
  },
  pinoPretty(),
);

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
