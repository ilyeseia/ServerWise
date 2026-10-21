# ServerWise — The AI assistant

Code: `src/modules/ai` (`rules.ts` pure guardrails, `config.ts`, `provider.ts`, `tools.ts`,
`gateway.ts`). The business works fully without it: if it is off, unreachable or over its allowance,
the buttons say so and nothing else changes.

**What it does:** explains a hardware recommendation, summarises a customer's history or a support
ticket, drafts a follow-up message, drafts handover notes. **What it never does:** calculate a price,
a total, a margin, a tax or a score; decide a permission; approve, accept, issue, send or save
anything. Its output is text on the screen, labelled "AI draft — review before use", that a person
may copy.

## 1. How a request flows (`gateway.ts`)

1. The user must hold `ai:use` **and** every permission the tool reads with (for example drafting a
   follow-up needs `crm:write`). Unknown tools are refused. Input is validated with zod.
2. **Risk gate:** tools are classified `read`, `draft` or `sensitive`. A `sensitive` tool would only
   ever return a proposal until a person confirms it. No sensitive tool exists today; the gate is
   there and tested for the day one does.
3. The assistant must be configured, and the user's **daily allowance** (default 100, per user, per
   UTC day) must not be used up. Refusals are not counted.
4. The data is read **through the normal services, as the signed-in user**, so every authorization
   check of the application applies. Free text is shortened, e-mail addresses and phone numbers are
   masked, and everything written by third parties is wrapped as `<untrusted_data>`; a closing tag
   inside the text is neutralised so it cannot escape the wrapper.
5. The provider answers; the reply must contain **one JSON object** that passes a schema
   (`text`, `points`, optional `subject`). Extra fields are dropped. Anything that looks like a
   password, key or token is removed from the answer.
6. A log line is written: user, tool, status, provider, model, sizes and duration. **The prompt and
   the answer are never stored.**

## 2. Why it cannot change anything

- A tool can only **read**: its module may import a short list of read functions
  (`getCustomer`, `listCommunications`, `getTicket`…) and nothing else. A unit test reads the source
  and fails if a write function, the database, the quotation arithmetic or the settings are imported
  (verified by deliberately adding such an import).
- The reply is parsed as data and rendered as plain text. Even a hostile reply
  (`{"approve": true, "role": "owner", "total": "0"}`) has no channel to act: unknown fields are
  dropped and nothing in the application executes model output.
- A prompt injection placed in a customer note or a ticket reaches the model only inside the
  wrapper, with the standing instruction to treat it as data. An integration test plants one and
  checks that customers, quotes, accepted revisions, roles and the audit log are unchanged.

## 3. Providers and configuration

Environment variables (see `.env.example`); nothing is stored in the database, the key is never
logged or shown:

| Variable                  | Meaning                                                             |
| ------------------------- | ------------------------------------------------------------------- |
| `AI_PROVIDER`             | `anthropic`, `openai` or `openai_compatible` (unset = AI off)       |
| `AI_API_KEY`              | the provider key                                                    |
| `AI_MODEL`                | the model id — **no default**: choose it deliberately               |
| `AI_BASE_URL`             | required for `openai_compatible` (for example a self-hosted server) |
| `AI_TIMEOUT_MS`           | per request, default 30000                                          |
| `AI_MAX_OUTPUT_TOKENS`    | default 1500                                                        |
| `AI_DAILY_LIMIT_PER_USER` | default 100; `0` switches the assistant off for everyone            |

AI settings are parsed **separately** from the application's: a wrong value turns the assistant off
(Settings shows which variable names are wrong, never their values) and never stops the application
from starting. Providers are plain `fetch` calls — no vendor SDK is installed. Every failure
(`401/403`, `429`, `5xx`, timeout, network, unreadable reply) becomes a short typed code; the
provider's error text, which can echo the prompt, is never copied into a message or a log.

**Honest limits:** the Anthropic and OpenAI request shapes follow their documented chat APIs and are
tested against a local stand-in server that plays each protocol; they have **not** been run against
the live services, because no key was available. The first real call should be made with a test key
and a harmless customer.

## 4. Privacy

Customer data leaves the server only when a person presses an assistant button, only the fields a
tool needs, with e-mail addresses and phone numbers masked and no tax identifiers, credentials or
keys. Using a third-party model still means sending business text to that company: choose the
provider (or a self-hosted `openai_compatible` server) with that in mind.

## 5. Tools today

| Tool                     | Class | Needs besides `ai:use`     |
| ------------------------ | ----- | -------------------------- |
| `explain_recommendation` | read  | `crm:read`, `catalog:read` |
| `summarize_customer`     | read  | `crm:read`                 |
| `summarize_ticket`       | read  | `ticket:read`              |
| `draft_followup_message` | draft | `crm:write`                |
| `draft_handover_notes`   | draft | `project:manage`           |

`ai:use`: owner, sales, technician (viewers: no).

## 6. Not in this stage

Retrieval over documents (RAG), log analysis, chat with memory, agents that act, automatic sending,
and any use of AI for money, permissions or approvals — which stay deterministic code.
