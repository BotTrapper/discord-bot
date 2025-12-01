import pino from "pino";
import crypto from "crypto";

// Determine log level based on environment
const getLogLevel = (): string => {
  if (process.env.LOG_LEVEL) {
    return process.env.LOG_LEVEL;
  }
  return process.env.NODE_ENV === "production" ? "info" : "debug";
};

// Build logger options
const loggerOptions: pino.LoggerOptions = {
  level: getLogLevel(),
  base: {
    env: process.env.NODE_ENV || "development",
  },
  formatters: {
    level: (label: string) => {
      return { level: label };
    },
  },
};

// Add transport only in development
if (process.env.NODE_ENV !== "production") {
  loggerOptions.transport = {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:standard",
      ignore: "pid,hostname",
    },
  };
}

// Create the base pino logger instance
const baseLogger = pino(loggerOptions);

// Logger interface with request ID support
export interface Logger {
  info: (msg: string, obj?: object) => void;
  debug: (msg: string, obj?: object) => void;
  warn: (msg: string, obj?: object) => void;
  error: (msg: string, obj?: object) => void;
  child: (bindings: object) => Logger;
}

// Generate a unique request ID
export const generateRequestId = (): string => {
  return crypto.randomBytes(8).toString("hex");
};

// Create a child logger with request context
export const createRequestLogger = (requestId: string): Logger => {
  return baseLogger.child({ requestId });
};

// Export the base logger for general use
export const logger: Logger = baseLogger;

// Export the raw pino logger for advanced use cases
export const pinoLogger = baseLogger;

// Log levels for reference
export const LogLevels = {
  TRACE: "trace",
  DEBUG: "debug",
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
  FATAL: "fatal",
} as const;
