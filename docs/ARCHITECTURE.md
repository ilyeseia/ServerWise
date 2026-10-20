# ServerWise — Architecture

## 1. Style

A **modular monolith**: one Next.js 16 application (App Router) + PostgreSQL 18. No separate backend service in v1 — the benefit (independent scaling/teams) does not apply to a single-business tool. Module boundaries are enforced in code so a service can be extracted later.

```
Browser ──HTTPS──> Reverse proxy (Caddy/Nginx) ──> Next.js app (Node 24, standalone)
                                                     │  UI (RSC + client islands)
                                                     │  Server Actions / Route Handlers
                                                     │  Application services (per module)
                                                     │  Data access (Prisma) + authz
                                                     ▼
                                                PostgreSQL 18 (volume, backups)
                                                     ▲
                       AI gateway ──> external LLM providers (optional, outbound only)
```

## 2. Repository layout (target, created in Stage 1)

```
src/
  app/[locale]/(auth)|(app)/...   routes (ar, fr)
  modules/<module>/               domain: schema (zod), service, policy, repository, tests
    crm/ questionnaire/ catalog/ suppliers/ quotes/ projects/
    inventory/ careops/ backups/ remote-access/ analytics/
  server/
    auth/  authz/  db/  audit/  logging/  rate-limit/  config/
    ai/    (provider interface, tools, guardrails, rag)
  components/ui/                  shadcn components
  i18n/ messages/ar.json fr.json
prisma/ schema.prisma migrations/
tests/ e2e/ integration/
docker/ Dockerfile compose.yml compose.dev.yml
docs/
```

## 3. Layering rules

1. **UI** never touches Prisma. 2. **Server Actions/route handlers** parse input with zod, call a module **service**. 3. Services call `authorize(user, permission, resource)` **first**, then repositories. 4. Repositories are the only Prisma users. 5. Cross-module calls go through a module's public `index.ts`. Lint rules (import boundaries) enforce this.

## 4. Data model (high level)

`User, Session, Role, AuditLog, Setting` · `Customer, Contact, Lead, FollowUp, Communication` · `Questionnaire(version), Question, Answer` · `Product, ProductSpec, Supplier, SupplierOffer(price, currency, source, condition, location, warranty, availability, verificationStatus, checkedAt)` · `Recommendation, RecommendationFactor` · `Quote, QuoteRevision, QuoteLine, PricingRule, TaxRule` · `Project, Task, Milestone, TaskDependency, TestResult, HandoverDoc` · `Asset, Service, NetworkDevice, Subscription` · `Ticket, MaintenanceContract, MaintenanceSchedule, ServiceReport` · `BackupPolicy, BackupRecord, RestoreTest` · `RemoteAccessPlan` · `AiConversation, AiToolCall` .
Conventions: UUIDv7/cuid ids, `createdAt/updatedAt`, soft-delete only where history matters, `numeric(14,2)` money, CHECK constraints, FK with explicit `onDelete`, indexes for every lookup/filter used by list pages. Detailed schema is produced per stage.

**Implemented in Stage 3 (CRM, `src/modules/crm`, `src/modules/questionnaire`):**

- Tables `customer`, `contact`, `lead`, `follow_up`, `communication`, `requirements_response`. Customers are never deleted: `archived` hides them and keeps history (`customer → lead/follow_up/communication` use `ON DELETE RESTRICT`).
- Rules enforced **in the database** as well as in code: wilaya 1..58, non-blank names, at most one primary contact per customer (partial unique index), lead budget range and non-negative amounts, a lost lead needs a reason, `closedAt` is set exactly when a lead is won/lost, a follow-up is `done` exactly when it has a completion time, an archived customer has an archive date, and the communication log is append-only (trigger).
- **Lead pipeline** is an explicit state machine (`lead-status.ts`): `new → contacted → qualified → proposal → won`, `lost` from any open stage, and `lost → contacted` to reopen. Winning a lead activates its customer in the same transaction.
- **Questionnaire definitions live in code** (`definition.ts`), versioned and reviewed in Git; each stored response records its `version` and keeps rendering with that version. A new version is added, never edited in place. The conditional engine (`engine.ts`) is pure: visible questions are computed from the answers of questions that are themselves visible, so a stale hidden answer can neither reveal nor hide anything. Database-managed, owner-editable questionnaires are a possible later extension; they are not needed to run the business today.
- Every service follows `assertCan` → zod parse → Prisma transaction that also writes the audit row. Server actions return a result with an error *code*; the UI translates codes (`Crm.errors.*`).
- Numbers and dates are formatted with the Algerian regional locales (`ar-DZ`, `fr-DZ`) so Arabic text uses Western digits (0-9).

## 5. Key flows

- **Enquiry → quote:** Lead → questionnaire → advisor ranks products using fresh verified offers → quote draft → review → issue (snapshot) → accept → project.
- **Quote calculation:** pure functions in `modules/quotes/calc` (no I/O); property tests for invariants (sum of lines = subtotal, rounding stable, margin ≥ definition).
- **Recommendation scoring:** weighted criteria with per-factor score, weight and evidence (spec value or offer id) stored so the explanation can be re-rendered later.
- **Price freshness:** `checkedAt + verificationStatus` → computed `fresh|stale|unverified`.
- **Scheduling:** maintenance reminders computed by a job runner (a Compose `worker` service running the same codebase on a cron loop; no external queue in v1). Jobs are idempotent.

## 6. AI architecture

```
UI ─> /api/ai ─> AiGateway ─> AiProvider (interface) ─> Anthropic | OpenAI | Google | OpenAI-compatible
                    │ guardrails: input validation, size limits, PII minimization
                    │ tools registry: each tool = {name, zod schema, permission, riskClass}
                    │ risk gate: sensitive => returns a ProposedAction, human must confirm
                    └ structured output validated by zod; failure => typed AiUnavailable/AiInvalid
```

- Tools run **as the requesting user** through the same services and authz as the UI. The model never receives credentials.
- No tool can set quote totals, change roles, expose services publicly, or run infrastructure commands; those paths only produce _drafts/proposals_.
- Retrieved documents are wrapped and labelled as untrusted data; instructions inside them are ignored; answers include source references.
- Provider unavailable → UI shows a non-blocking notice; the rest of the app is unaffected.

## 7. Tenancy

Single business. Every table is a single-tenant table; there is no `tenantId`. Adding multi-tenancy later requires a schema migration and a data-access enforcement layer — documented as a non-goal for v1 to avoid a half-built isolation model.

## 8. Internationalization

Locale in URL (`/ar/...`, `/fr/...`), `<html lang dir>` set server-side, Tailwind logical properties only (no `left/right` utilities), mirrored icons, ICU messages. Stored content (e.g. customer notes) is user-language data and is not translated.

## 9. Observability

Structured JSON logs (pino) with request id and redaction; `/api/health` (liveness) and `/api/ready` (DB check); audit log in DB; optional OpenTelemetry later.

## 10. Deployment topology

Services: `proxy` (TLS), `app`, `worker`, `db`, one-shot `migrate`. Networks: only `proxy` is public; `db` on an internal network. Volumes: `pgdata`, `backups`. Separate `compose.dev.yml` (hot reload, exposed DB on localhost) and `compose.prod.yml` (no published DB port, healthchecks, restart policies, secrets via env files/Docker secrets).

## 11. Environment prerequisites and constraints

- Dev: Node 24, pnpm (via Corepack), Docker Desktop (present), Git. Local Node is 22.22.0 → upgrade; local PostgreSQL absent → use Compose.
- Prod: Linux VPS or on-prem mini-PC, 2 vCPU/4 GB, domain + TLS, SMTP for notifications (optional), outbound HTTPS for AI (optional).
- Algeria-specific: variable bandwidth and possible provider blocking → no mandatory third-party runtime dependency, self-hosted fonts, no CDN requirements, offline-tolerant UI states.
- Hosting data in-country vs abroad is a business/legal decision (see PRODUCT_REQUIREMENTS R5).
