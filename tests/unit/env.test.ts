import { describe, expect, it } from "vitest";
import { isOwner2faRequired, parseEnv } from "@/server/config/env";

describe("parseEnv", () => {
  it("applies defaults when nothing is set", () => {
    const env = parseEnv({});
    expect(env.NODE_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.APP_URL).toBe("http://localhost:3000");
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it("accepts a PostgreSQL connection string", () => {
    const env = parseEnv({ DATABASE_URL: "postgresql://u:p@localhost:5432/db" });
    expect(env.DATABASE_URL).toContain("postgresql://");
  });

  it("rejects a non-PostgreSQL DATABASE_URL", () => {
    expect(() => parseEnv({ DATABASE_URL: "mysql://u:p@h/db" })).toThrow(/DATABASE_URL/);
  });

  it("rejects an invalid LOG_LEVEL", () => {
    expect(() => parseEnv({ LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/);
  });

  it("requires a strong AUTH_SECRET in production only", () => {
    expect(() => parseEnv({ NODE_ENV: "production" })).toThrow(/AUTH_SECRET/);
    expect(() => parseEnv({ NODE_ENV: "production", AUTH_SECRET: "short" })).toThrow(/AUTH_SECRET/);
    expect(
      parseEnv({ NODE_ENV: "production", AUTH_SECRET: "x".repeat(32) }).AUTH_SECRET,
    ).toHaveLength(32);
    expect(() => parseEnv({ NODE_ENV: "development" })).not.toThrow();
  });

  it("parses trusted origins and rejects invalid ones", () => {
    const env = parseEnv({ AUTH_TRUSTED_ORIGINS: "https://a.example.com, https://b.example.com" });
    expect(env.AUTH_TRUSTED_ORIGINS).toEqual(["https://a.example.com", "https://b.example.com"]);
    expect(parseEnv({}).AUTH_TRUSTED_ORIGINS).toEqual([]);
    expect(() => parseEnv({ AUTH_TRUSTED_ORIGINS: "not-a-url" })).toThrow(/AUTH_TRUSTED_ORIGINS/);
  });

  it("requires owner 2FA by default in production, and honours an explicit override", () => {
    const secret = "x".repeat(32);
    expect(isOwner2faRequired(parseEnv({ NODE_ENV: "production", AUTH_SECRET: secret }))).toBe(
      true,
    );
    expect(isOwner2faRequired(parseEnv({ NODE_ENV: "development" }))).toBe(false);
    expect(
      isOwner2faRequired(
        parseEnv({ NODE_ENV: "production", AUTH_SECRET: secret, REQUIRE_OWNER_2FA: "false" }),
      ),
    ).toBe(false);
    expect(isOwner2faRequired(parseEnv({ REQUIRE_OWNER_2FA: "true" }))).toBe(true);
  });

  it("never leaks the offending value in the error message", () => {
    const secret = "mysql://user:SuperSecret123@host/db";
    try {
      parseEnv({ DATABASE_URL: secret });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain("SuperSecret123");
    }
  });
});
