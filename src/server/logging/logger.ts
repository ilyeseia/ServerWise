import pino from "pino";

/** Paths whose values must never reach the logs. */
export const REDACT_PATHS = [
  "password",
  "*.password",
  "newPassword",
  "*.newPassword",
  "currentPassword",
  "*.currentPassword",
  "temporaryPassword",
  "*.temporaryPassword",
  "token",
  "*.token",
  "secret",
  "*.secret",
  "totpURI",
  "*.totpURI",
  "backupCodes",
  "*.backupCodes",
  "authorization",
  "*.authorization",
  "cookie",
  "*.cookie",
  "headers.authorization",
  "headers.cookie",
  "apiKey",
  "*.apiKey",
  "DATABASE_URL",
  "AUTH_SECRET",
];

const LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"];

/**
 * The logger is imported by almost everything, including at build time, so it reads only
 * LOG_LEVEL and never validates the rest of the environment (see config/env.ts for that).
 */
function levelFromEnv(): string {
  const level = process.env.LOG_LEVEL;
  return level && LEVELS.includes(level) ? level : "info";
}

export function createLogger(level?: string) {
  return pino({
    level: level ?? levelFromEnv(),
    base: { service: "serverwise" },
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export const logger = createLogger();
