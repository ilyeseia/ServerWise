import { describe, expect, it } from "vitest";
import { describeAiConfig, parseAiConfig } from "@/modules/ai/config";

const valid = {
  AI_PROVIDER: "anthropic",
  AI_API_KEY: "sk-ant-test-key-1234567890",
  AI_MODEL: "some-model-id",
};

describe("AI configuration", () => {
  it("is off when nothing is set", () => {
    expect(parseAiConfig({})).toEqual({ enabled: false, reason: "not_configured", problems: [] });
    expect(parseAiConfig({ AI_PROVIDER: "", AI_API_KEY: "x" })).toMatchObject({
      reason: "not_configured",
    });
  });

  it("is on when provider, key and model are present, with documented defaults", () => {
    expect(parseAiConfig(valid)).toEqual({
      enabled: true,
      provider: "anthropic",
      apiKey: "sk-ant-test-key-1234567890",
      model: "some-model-id",
      baseUrl: null,
      timeoutMs: 30_000,
      maxOutputTokens: 1500,
      dailyLimitPerUser: 100,
    });
  });

  it("has no default model: choosing one is deliberate", () => {
    const result = parseAiConfig({ AI_PROVIDER: "openai", AI_API_KEY: valid.AI_API_KEY });
    expect(result).toEqual({ enabled: false, reason: "invalid_config", problems: ["AI_MODEL"] });
  });

  it("names the wrong settings, never their values", () => {
    const result = parseAiConfig({
      ...valid,
      AI_API_KEY: "short",
      AI_TIMEOUT_MS: "999999",
    });
    expect(result.enabled).toBe(false);
    if (!result.enabled) {
      expect(result.reason).toBe("invalid_config");
      expect(result.problems.sort()).toEqual(["AI_API_KEY", "AI_TIMEOUT_MS"]);
      expect(JSON.stringify(result)).not.toContain("short");
    }
  });

  it("rejects an unknown provider", () => {
    expect(parseAiConfig({ ...valid, AI_PROVIDER: "skynet" })).toMatchObject({
      reason: "invalid_config",
      problems: ["AI_PROVIDER"],
    });
  });

  it("an OpenAI-compatible server needs its address", () => {
    const base = { ...valid, AI_PROVIDER: "openai_compatible" };
    expect(parseAiConfig(base)).toMatchObject({
      reason: "invalid_config",
      problems: ["AI_BASE_URL"],
    });
    expect(parseAiConfig({ ...base, AI_BASE_URL: "not a url" })).toMatchObject({
      problems: ["AI_BASE_URL"],
    });
    expect(parseAiConfig({ ...base, AI_BASE_URL: "http://localhost:11434" })).toMatchObject({
      enabled: true,
      baseUrl: "http://localhost:11434",
    });
  });

  it("a daily limit of zero switches the assistant off for everyone", () => {
    expect(parseAiConfig({ ...valid, AI_DAILY_LIMIT_PER_USER: "0" })).toEqual({
      enabled: false,
      reason: "disabled_by_limit",
      problems: [],
    });
    expect(parseAiConfig({ ...valid, AI_DAILY_LIMIT_PER_USER: "5" })).toMatchObject({
      dailyLimitPerUser: 5,
    });
  });

  it("ignores variables that are not AI settings", () => {
    expect(
      parseAiConfig({ ...valid, DATABASE_URL: "postgresql://x", AUTH_SECRET: "y" }),
    ).toMatchObject({
      enabled: true,
    });
  });

  it("never exposes the key when describing the configuration", () => {
    const on = describeAiConfig(parseAiConfig(valid));
    expect(on).toEqual({
      enabled: true,
      provider: "anthropic",
      model: "some-model-id",
      dailyLimitPerUser: 100,
    });
    expect(JSON.stringify(on)).not.toContain("sk-ant");
    expect(describeAiConfig(parseAiConfig({}))).toMatchObject({ enabled: false });
  });
});
