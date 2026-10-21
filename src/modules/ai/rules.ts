/**
 * Pure guardrails for the AI assistant. No I/O, no clock, no network: every rule here is
 * deterministic and unit-tested. The assistant explains, summarises and drafts - it never computes
 * money, never decides permissions and never approves anything (project rule); these functions are
 * the part of that promise that can be checked mechanically.
 */

// ---------------------------------------------------------------------------------------------
// Risk gate
// ---------------------------------------------------------------------------------------------

/**
 * read       looks at data the user may already see and writes text about it
 * draft      produces text the user may copy or edit; nothing is saved or sent
 * sensitive  would change something; never runs without an explicit human confirmation
 */
export const RISK_CLASSES = ["read", "draft", "sensitive"] as const;
export type RiskClass = (typeof RISK_CLASSES)[number];

export type GateDecision = "run" | "needs_confirmation";

/** Sensitive actions are returned as proposals until a person confirms; others run. */
export function gateAction(risk: RiskClass, confirmedByHuman: boolean): GateDecision {
  if (risk === "sensitive" && !confirmedByHuman) return "needs_confirmation";
  return "run";
}

// ---------------------------------------------------------------------------------------------
// Untrusted data
// ---------------------------------------------------------------------------------------------

const TAG = "untrusted_data";

/**
 * Wraps third-party text (a customer's message, a ticket, a note) so the model sees it as data.
 * The closing tag is neutralised inside the text, so the text cannot "close" the wrapper and
 * continue as if it were instructions. Output is truncated to `maxChars`.
 */
export function wrapUntrusted(source: string, text: string, maxChars = 4000): string {
  const label = source.replace(/[^a-z0-9_]/gi, "_").slice(0, 40) || "data";
  const body = text
    .slice(0, maxChars)
    // Break any attempt to write our own opening or closing tag, in any case or spacing.
    .replace(/<\s*\/?\s*untrusted[_\s-]*data[^>]*>?/gi, "[tag removed]");
  const cut = text.length > maxChars ? "\n[truncated]" : "";
  return `<${TAG} source="${label}">\n${body}${cut}\n</${TAG}>`;
}

// ---------------------------------------------------------------------------------------------
// Personal data and secrets
// ---------------------------------------------------------------------------------------------

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Algerian numbers (0X XX XX XX XX, +213 ...), spaced or dashed, and generic long digit runs.
const PHONE = /(?:\+|00)?\d(?:[\s().-]?\d){8,14}/g;
const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\btskey-[A-Za-z0-9-]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  // "password: hunter2", "mot de passe = ...", "كلمة المرور: ..."
  /(?:password|passwd|pwd|secret|token|api[_ -]?key|mot de passe|mdp|كلمة (?:ال)?(?:مرور|سر))\s*[:=：]\s*\S+/gi,
  // Long opaque strings that look like keys.
  /\b[A-Za-z0-9+/_-]{40,}={0,2}\b/g,
];

/** Replaces e-mail addresses and phone numbers, so they are not sent to a third-party model. */
export function maskPii(text: string): string {
  return text.replace(EMAIL, "[email]").replace(PHONE, "[phone]");
}

/** Removes anything that looks like a credential or key. Applied to model output as well. */
export function redactSecrets(text: string): { text: string; redacted: boolean } {
  let redacted = false;
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, () => {
      redacted = true;
      return "[removed]";
    });
  }
  return { text: out, redacted };
}

// ---------------------------------------------------------------------------------------------
// Model output
// ---------------------------------------------------------------------------------------------

/**
 * Finds the first complete JSON object in a model reply, tolerating Markdown code fences and
 * surrounding prose. Returns undefined when there is none. The caller must still validate it.
 */
export function extractJson(reply: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(reply);
  const candidates = [fenced?.[1], reply].filter((c): c is string => Boolean(c));
  for (const candidate of candidates) {
    const start = candidate.indexOf("{");
    if (start === -1) continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < candidate.length; i++) {
      const ch = candidate[i]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1));
        } catch {
          break;
        }
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------------------------

export interface Budget {
  used: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
}

/** How much of a per-user daily allowance is left. A limit of 0 means "no AI for anyone". */
export function budget(used: number, limit: number): Budget {
  const remaining = Math.max(0, limit - used);
  return { used, limit, remaining, exhausted: remaining === 0 };
}

/** Start of the UTC day containing `now` (the window of the daily allowance). */
export function dayStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
