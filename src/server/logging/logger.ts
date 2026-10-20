import pino from "pino";
import { getEnv } from "@/server/config/env";

/** Paths whose values must never reach the logs. */
export const REDACT_PATHS = [
  "password",
  "*.password",
  "token",
  "*.token",
  "authorization",
  "*.authorization",
  "cookie",
  "*.cookie",
  "headers.authorization",
  "headers.cookie",
  "apiKey",
  "*.apiKey",
  "DATABASE_URL",
];

export function createLogger(level?: string) {
  return pino({
    level: level ?? getEnv().LOG_LEVEL,
    base: { service: "serverwise" },
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export const logger = createLogger();
