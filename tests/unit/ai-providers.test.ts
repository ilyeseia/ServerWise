import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { AiConfigOn } from "@/modules/ai/config";
import { AiInvalidError, AiUnavailableError, createProvider } from "@/modules/ai/provider";

/** A tiny local HTTP server that plays the part of a provider and records what it received. */
interface Seen {
  method?: string;
  url?: string;
  headers: IncomingMessage["headers"];
  body: Record<string, unknown>;
}

let server: Server | undefined;

async function serve(
  handler: (seen: Seen, respond: (status: number, body: unknown, delayMs?: number) => void) => void,
) {
  const seen: Seen[] = [];
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const entry: Seen = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: raw ? JSON.parse(raw) : {},
      };
      seen.push(entry);
      handler(entry, (status, body, delayMs = 0) => {
        setTimeout(() => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(typeof body === "string" ? body : JSON.stringify(body));
        }, delayMs);
      });
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, seen };
}

afterEach(async () => {
  if (server) await new Promise((resolve) => server!.close(resolve));
  server = undefined;
});

const config = (over: Partial<AiConfigOn>): AiConfigOn => ({
  enabled: true,
  provider: "anthropic",
  apiKey: "test-key-0123456789",
  model: "test-model",
  baseUrl: null,
  timeoutMs: 5000,
  maxOutputTokens: 321,
  dailyLimitPerUser: 100,
  ...over,
});

const request = { system: "SYS", user: "USER", maxTokens: 321, timeoutMs: 5000 };

describe("Anthropic provider", () => {
  it("sends the documented request and reads the text blocks", async () => {
    const { baseUrl, seen } = await serve((_, respond) =>
      respond(200, {
        content: [
          { type: "text", text: "Hello " },
          { type: "text", text: "world" },
        ],
      }),
    );
    const provider = createProvider(config({ provider: "anthropic", baseUrl }));
    expect(provider.name).toBe("anthropic");
    await expect(provider.generate(request)).resolves.toEqual({ text: "Hello world" });

    expect(seen[0]).toMatchObject({ method: "POST", url: "/v1/messages" });
    expect(seen[0]!.headers["x-api-key"]).toBe("test-key-0123456789");
    expect(seen[0]!.headers["anthropic-version"]).toBe("2023-06-01");
    expect(seen[0]!.body).toEqual({
      model: "test-model",
      max_tokens: 321,
      system: "SYS",
      messages: [{ role: "user", content: "USER" }],
    });
  });

  it("treats a reply without text as invalid", async () => {
    const { baseUrl } = await serve((_, respond) => respond(200, { content: [] }));
    await expect(createProvider(config({ baseUrl })).generate(request)).rejects.toBeInstanceOf(
      AiInvalidError,
    );
  });
});

describe("OpenAI and compatible providers", () => {
  it("OpenAI uses max_completion_tokens and a bearer key", async () => {
    const { baseUrl, seen } = await serve((_, respond) =>
      respond(200, { choices: [{ message: { content: "Bonjour" } }] }),
    );
    const provider = createProvider(config({ provider: "openai", baseUrl }));
    await expect(provider.generate(request)).resolves.toEqual({ text: "Bonjour" });
    expect(seen[0]).toMatchObject({ method: "POST", url: "/v1/chat/completions" });
    expect(seen[0]!.headers.authorization).toBe("Bearer test-key-0123456789");
    expect(seen[0]!.body).toEqual({
      model: "test-model",
      max_completion_tokens: 321,
      messages: [
        { role: "system", content: "SYS" },
        { role: "user", content: "USER" },
      ],
    });
  });

  it("a compatible server gets the classic max_tokens", async () => {
    const { baseUrl, seen } = await serve((_, respond) =>
      respond(200, { choices: [{ message: { content: "ok" } }] }),
    );
    const provider = createProvider(config({ provider: "openai_compatible", baseUrl }));
    expect(provider.name).toBe("openai_compatible");
    await provider.generate(request);
    expect(seen[0]!.body).toMatchObject({ max_tokens: 321 });
    expect(seen[0]!.body).not.toHaveProperty("max_completion_tokens");
  });

  it("treats a reply without content as invalid", async () => {
    const { baseUrl } = await serve((_, respond) => respond(200, { choices: [] }));
    await expect(
      createProvider(config({ provider: "openai", baseUrl })).generate(request),
    ).rejects.toBeInstanceOf(AiInvalidError);
  });
});

describe("failures degrade to typed errors without leaking anything", () => {
  const cases: [number, string][] = [
    [401, "auth"],
    [403, "auth"],
    [429, "rate_limited"],
    [500, "provider_error"],
    [503, "provider_error"],
    [400, "provider_error"],
  ];
  for (const [status, code] of cases) {
    it(`HTTP ${status} becomes "${code}", with no provider text in the error`, async () => {
      const secretEcho = "ECHOED-CUSTOMER-DATA-0555123456";
      const { baseUrl } = await serve((_, respond) =>
        respond(status, { error: { message: `bad request: ${secretEcho}` } }),
      );
      for (const provider of ["anthropic", "openai"] as const) {
        const error = await createProvider(config({ provider, baseUrl }))
          .generate(request)
          .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(AiUnavailableError);
        expect((error as AiUnavailableError).code).toBe(code);
        expect(String((error as Error).message)).not.toContain(secretEcho);
        expect(String((error as Error).message)).not.toContain("test-key");
      }
    });
  }

  it("a body that is not JSON is invalid, not a crash", async () => {
    const { baseUrl } = await serve((_, respond) => respond(200, "<html>oops</html>"));
    await expect(createProvider(config({ baseUrl })).generate(request)).rejects.toBeInstanceOf(
      AiInvalidError,
    );
  });

  it("a slow provider times out", async () => {
    const { baseUrl } = await serve((_, respond) => respond(200, { content: [] }, 1500));
    const error = await createProvider(config({ baseUrl }))
      .generate({ ...request, timeoutMs: 100 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiUnavailableError);
    expect((error as AiUnavailableError).code).toBe("timeout");
  });

  it("an unreachable provider is a network error", async () => {
    const error = await createProvider(config({ baseUrl: "http://127.0.0.1:1" }))
      .generate(request)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiUnavailableError);
    expect((error as AiUnavailableError).code).toBe("network");
  });
});
