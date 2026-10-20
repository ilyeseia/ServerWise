import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { REDACT_PATHS } from "@/server/logging/logger";

describe("logger redaction", () => {
  it("redacts secrets and keeps ordinary fields", () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk.toString());
        cb();
      },
    });
    const log = pino({ redact: { paths: REDACT_PATHS, censor: "[REDACTED]" } }, stream);

    log.info({ user: "amine", password: "hunter2", headers: { cookie: "sid=abc" } }, "login");

    const line = chunks.join("");
    expect(line).toContain("amine");
    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("sid=abc");
    expect(line).toContain("[REDACTED]");
  });
});
