import type { AiConfigOn } from "./config";

/**
 * The provider interface. A provider turns one system prompt and one user message into text. It
 * knows nothing about tools, users or permissions - the gateway does - so providers are
 * interchangeable and easy to fake in tests.
 */
export interface AiRequestInput {
  system: string;
  user: string;
  maxTokens: number;
  timeoutMs: number;
}

export interface AiCompletion {
  text: string;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  generate(input: AiRequestInput): Promise<AiCompletion>;
}

/** The assistant could not be reached or refused: the rest of the application carries on. */
export class AiUnavailableError extends Error {
  constructor(
    readonly code:
      "not_configured" | "timeout" | "network" | "auth" | "rate_limited" | "provider_error",
    message = code,
  ) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

/** The assistant answered, but not in the shape we asked for. */
export class AiInvalidError extends Error {
  constructor(
    readonly code: "bad_response" | "bad_output",
    message = code,
  ) {
    super(message);
    this.name = "AiInvalidError";
  }
}

type Fetch = typeof fetch;

/**
 * POSTs JSON and returns the parsed body. Errors become `AiUnavailableError`/`AiInvalidError` with
 * a short code only: a provider's error body can echo the prompt (customer data), so it is never
 * copied into a message or a log.
 */
async function postJson(
  fetchImpl: Fetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    throw new AiUnavailableError(
      name === "TimeoutError" || name === "AbortError" ? "timeout" : "network",
    );
  }
  if (response.status === 401 || response.status === 403) throw new AiUnavailableError("auth");
  if (response.status === 429) throw new AiUnavailableError("rate_limited");
  if (!response.ok) throw new AiUnavailableError("provider_error");
  try {
    return await response.json();
  } catch {
    throw new AiInvalidError("bad_response");
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export function anthropicProvider(config: AiConfigOn, fetchImpl: Fetch = fetch): AiProvider {
  const base = (config.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "");
  return {
    name: "anthropic",
    model: config.model,
    async generate(input) {
      const json = await postJson(
        fetchImpl,
        `${base}/v1/messages`,
        { "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" },
        {
          model: config.model,
          max_tokens: input.maxTokens,
          system: input.system,
          messages: [{ role: "user", content: input.user }],
        },
        input.timeoutMs,
      );
      const content = isRecord(json) && Array.isArray(json.content) ? json.content : [];
      const text = content
        .filter(
          (part): part is { type: string; text: string } =>
            isRecord(part) && part.type === "text" && typeof part.text === "string",
        )
        .map((part) => part.text)
        .join("");
      if (!text) throw new AiInvalidError("bad_response");
      return { text };
    },
  };
}

/** OpenAI, and any server that speaks the same chat-completions protocol. */
export function openAiProvider(config: AiConfigOn, fetchImpl: Fetch = fetch): AiProvider {
  const compatible = config.provider === "openai_compatible";
  const base = (config.baseUrl ?? "https://api.openai.com").replace(/\/+$/, "");
  return {
    name: config.provider,
    model: config.model,
    async generate(input) {
      const json = await postJson(
        fetchImpl,
        `${base}/v1/chat/completions`,
        { authorization: `Bearer ${config.apiKey}` },
        {
          model: config.model,
          // OpenAI renamed the limit; self-hosted servers still expect the original name.
          ...(compatible
            ? { max_tokens: input.maxTokens }
            : { max_completion_tokens: input.maxTokens }),
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.user },
          ],
        },
        input.timeoutMs,
      );
      const choices = isRecord(json) && Array.isArray(json.choices) ? json.choices : [];
      const message = isRecord(choices[0]) ? choices[0].message : undefined;
      const text = isRecord(message) && typeof message.content === "string" ? message.content : "";
      if (!text) throw new AiInvalidError("bad_response");
      return { text };
    },
  };
}

export function createProvider(config: AiConfigOn, fetchImpl: Fetch = fetch): AiProvider {
  return config.provider === "anthropic"
    ? anthropicProvider(config, fetchImpl)
    : openAiProvider(config, fetchImpl);
}
