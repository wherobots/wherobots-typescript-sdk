import log from "loglevel";
import { SessionReponse } from "./schemas";

const shouldUseDebugLogging = (process.env["NODE_DEBUG"] || "")
  .split(",")
  .includes("wherobots-sql-driver");

// Configure the default logger
log.setLevel(shouldUseDebugLogging ? log.levels.DEBUG : log.levels.INFO);

// If tests are running, disable the logger
if (process.env["NODE_ENV"] === "test") {
  log.setLevel(log.levels.SILENT);
}

// Setup a method factory to format log messages with context
const originalFactory = log.methodFactory;
log.methodFactory = function (methodName, logLevel, loggerName) {
  const rawMethod = originalFactory(methodName, logLevel, loggerName);

  return function (...args) {
    // Check if the last argument is an object (context)
    const lastArg = args[args.length - 1];
    const hasContext =
      lastArg && typeof lastArg === "object" && !Array.isArray(lastArg);

    if (hasContext && args.length > 1) {
      // Format message with context
      const context = args.pop();
      const formattedContext = Object.entries(context)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join(" ");

      rawMethod(`${args.join(" ")} [${formattedContext}]`);
    } else {
      // Regular logging without context
      rawMethod(...args);
    }
  };
};

// Apply the method factory
log.setDefaultLevel(log.getLevel());

abstract class Logger {
  abstract debug(...args: any[]): void;
  abstract info(...args: any[]): void;
  abstract warn(...args: any[]): void;
  abstract error(...args: any[]): void;
  abstract child(context: Record<string, any>): Logger;
}

class LogLevelLogger extends Logger {
  private context: Record<string, any>;

  constructor(context?: Record<string, any>) {
    super();
    this.context = context || {};
  }

  debug(...args: any[]) {
    if (Object.keys(this.context).length > 0) {
      log.debug(...args, this.context);
    } else {
      log.debug(...args);
    }
  }

  info(...args: any[]) {
    if (Object.keys(this.context).length > 0) {
      log.info(...args, this.context);
    } else {
      log.info(...args);
    }
  }

  warn(...args: any[]) {
    if (Object.keys(this.context).length > 0) {
      log.warn(...args, this.context);
    } else {
      log.warn(...args);
    }
  }

  error(...args: any[]) {
    if (Object.keys(this.context).length > 0) {
      log.error(...args, this.context);
    } else {
      log.error(...args);
    }
  }

  child(context: Record<string, any>) {
    return new LogLevelLogger({ ...this.context, ...context });
  }
}

const logger = new LogLevelLogger();

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
