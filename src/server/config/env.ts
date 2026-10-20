import { z } from "zod";

const boolString = z.enum(["true", "false"]).transform((v) => v === "true");

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    APP_URL: z.url().default("http://localhost:3000"),
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\//, "DATABASE_URL must be a PostgreSQL connection string")
      .optional(),
    /** Signs/encrypts auth data. Required in production (>= 32 chars). Generate: openssl rand -base64 32 */
    AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters").optional(),
    /** Extra browser origins allowed to call the auth API (comma separated), besides APP_URL. */
    AUTH_TRUSTED_ORIGINS: z
      .string()
      .optional()
      .transform((v) =>
        (v ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.url())),
    /** Owners must enrol TOTP before using the app. Defaults to true in production. */
    REQUIRE_OWNER_2FA: boolString.optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && !env.AUTH_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_SECRET"],
        message: "AUTH_SECRET is required in production",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Parses and validates environment variables. Throws a readable error that lists the
 * offending variable names only (never their values, which may be secrets).
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  // `KEY=` (empty) in a .env or compose file means "not set".
  const present = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ""));
  const result = envSchema.safeParse(present);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((i) => i.path.join(".") || "(root)"))];
    throw new Error(`Invalid environment configuration: ${names.join(", ")}`);
  }
  return result.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Whether owners must have TOTP enabled (explicit setting wins; default on in production). */
export function isOwner2faRequired(env: Env = getEnv()): boolean {
  return env.REQUIRE_OWNER_2FA ?? env.NODE_ENV === "production";
}
