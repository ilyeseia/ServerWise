import { z } from "zod";

/**
 * AI configuration lives in its own environment variables and is parsed separately from the
 * application's: a wrong AI setting must never stop the application from starting. When anything
 * is missing or invalid the assistant is simply off, with a reason the owner can read.
 *
 *   AI_PROVIDER             anthropic | openai | openai_compatible   (unset = AI off)
 *   AI_API_KEY              the provider key (never stored, never logged, never shown)
 *   AI_MODEL                the model id to use (no default: choose it deliberately)
 *   AI_BASE_URL             required for openai_compatible (for example a self-hosted server)
 *   AI_TIMEOUT_MS           per request, default 30000
 *   AI_MAX_OUTPUT_TOKENS    default 1500
 *   AI_DAILY_LIMIT_PER_USER default 100; 0 switches the assistant off for everyone
 */

export const AI_PROVIDERS = ["anthropic", "openai", "openai_compatible"] as const;
export type AiProviderName = (typeof AI_PROVIDERS)[number];

const schema = z.object({
  AI_PROVIDER: z.enum(AI_PROVIDERS),
  AI_API_KEY: z.string().min(8),
  AI_MODEL: z.string().trim().min(1).max(120),
  AI_BASE_URL: z.url().optional(),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(100).max(8000).default(1500),
  AI_DAILY_LIMIT_PER_USER: z.coerce.number().int().min(0).max(100_000).default(100),
});

export type AiConfigOff = {
  enabled: false;
  /** not_configured: nobody set it up. invalid_config: something is set but wrong. */
  reason: "not_configured" | "invalid_config" | "disabled_by_limit";
  /** The names (never the values) of the settings that are wrong. */
  problems: string[];
};

export type AiConfigOn = {
  enabled: true;
  provider: AiProviderName;
  apiKey: string;
  model: string;
  baseUrl: string | null;
  timeoutMs: number;
  maxOutputTokens: number;
  dailyLimitPerUser: number;
};

export type AiConfig = AiConfigOn | AiConfigOff;

export function parseAiConfig(source: Record<string, string | undefined>): AiConfig {
  const present = Object.fromEntries(
    Object.entries(source).filter(
      ([key, value]) => key.startsWith("AI_") && value !== undefined && value !== "",
    ),
  );
  if (!present.AI_PROVIDER) return { enabled: false, reason: "not_configured", problems: [] };

  const parsed = schema.safeParse(present);
  const problems = new Set<string>();
  if (!parsed.success) {
    for (const issue of parsed.error.issues) problems.add(String(issue.path[0] ?? "AI_PROVIDER"));
  } else if (parsed.data.AI_PROVIDER === "openai_compatible" && !parsed.data.AI_BASE_URL) {
    problems.add("AI_BASE_URL");
  }
  if (problems.size > 0 || !parsed.success) {
    return { enabled: false, reason: "invalid_config", problems: [...problems] };
  }

  const env = parsed.data;
  if (env.AI_DAILY_LIMIT_PER_USER === 0) {
    return { enabled: false, reason: "disabled_by_limit", problems: [] };
  }
  return {
    enabled: true,
    provider: env.AI_PROVIDER,
    apiKey: env.AI_API_KEY,
    model: env.AI_MODEL,
    baseUrl: env.AI_BASE_URL ?? null,
    timeoutMs: env.AI_TIMEOUT_MS,
    maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
    dailyLimitPerUser: env.AI_DAILY_LIMIT_PER_USER,
  };
}

export function getAiConfig(): AiConfig {
  return parseAiConfig(process.env);
}

/** What the owner may see: everything except the key. */
export function describeAiConfig(config: AiConfig) {
  return config.enabled
    ? {
        enabled: true as const,
        provider: config.provider,
        model: config.model,
        dailyLimitPerUser: config.dailyLimitPerUser,
      }
    : { enabled: false as const, reason: config.reason, problems: config.problems };
}
