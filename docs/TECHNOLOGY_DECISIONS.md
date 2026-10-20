# ServerWise — Technology Decisions

> Status: **Stage 0 (blueprint)**. Nothing below is installed yet.
> Versions were read from the npm registry, endoflife.date and nodejs.org on **2026-10-20**.
> They are re-verified at the start of Stage 1 (Stage 1 pins exact versions in a lockfile).
> Items marked **TO VERIFY** were not confirmed from a primary source during Stage 0.

## 1. Summary table

| Area | Selected | Version verified | Notes |
|---|---|---|---|
| Runtime | Node.js **24 LTS** | 24.22.0 | Local machine has 22.22.0 — upgrade needed (see §3.1) |
| Framework | Next.js (App Router) | 16.4.2 (`latest`) | Peer: React ^19, Node >=20.9 |
| UI library | React | 19.3.1 | |
| Language | TypeScript | **6.0.3** (not 7.x) | See §3.2 |
| Styling | Tailwind CSS (+ `@tailwindcss/postcss`) | 4.3.3 | Logical properties for RTL |
| Components | shadcn/ui (copied source, Radix primitives) | CLI 4.22.1 | Radix `react-dialog` 1.3.1 |
| Icons | lucide-react | 1.60.0 | |
| Forms/validation | react-hook-form + zod | 7.90.0 / 4.6.7 | One zod schema shared client/server |
| i18n | next-intl | 4.14.9 | Peer: Next ^16 supported |
| Database | PostgreSQL | **18.6** (EOL 2030-11-14) | 17.11 acceptable fallback |
| ORM/migrations | Prisma | **7.10.1** (`prev` tag; 8.x is still RC) | Apache-2.0; Node ^20.19/^22.12/>=24 |
| Auth | Better Auth | 1.7.11 (MIT) | Peers: Next ^16, Prisma ^7 |
| Authorization | In-house RBAC permission matrix | — | CASL 7.0.2 evaluated in Stage 2 |
| Money | decimal.js + `numeric(14,2)` | 10.6.0 | Deterministic, tested |
| Rate limiting | rate-limiter-flexible (Postgres store) | 11.2.3 | No Redis in v1 |
| Logging | pino | 10.4.0 | Redaction of secrets |
| PDF | @react-pdf/renderer (spike) | 4.9.0 | Arabic shaping risk — see §3.6 |
| AI abstraction | Vercel AI SDK (`ai`) + provider packages | 7.0.146 | Node >=22; license **TO VERIFY** |
| Vector search | pgvector (only if RAG proves its value) | npm client 0.3.0 | Stage 9 decision |
| Unit/integration | Vitest | 5.0.5 | Node ^22.12/^24/>=26 |
| E2E + a11y | Playwright + @axe-core/playwright | 1.64.1 / 4.14.0 | |
| Lint/format | ESLint + typescript-eslint + Prettier | 10.13.0 / 8.72.0 / 3.9.10 | |
| Package manager | pnpm (pinned via Corepack/`packageManager`) | 12.14.0 | Not installed locally yet |
| Containers | Docker + Compose | 28.1.1 / v2.36.0 (installed locally) | |
| CI | GitHub Actions | — | |

## 2. Decision records

### 2.1 Next.js 16 (App Router), single full-stack app
- **Docs:** https://nextjs.org/docs
- **Why:** One typed codebase for UI, server actions and route handlers, first-class Server Components (good for data-heavy back-office screens), stable `latest` channel, `output: "standalone"` for small Docker images.
- **Alternatives:** Separate NestJS API + SPA (more moving parts, two deploy units, no clear benefit for a single-business tool); Remix/React Router; SvelteKit (smaller ecosystem for the chosen UI kit).
- **Limitations:** Server Actions are not a public API — a documented REST/route-handler surface is added only if integrations require it. Framework upgrades are frequent; pin exact versions and upgrade via a dedicated PR.
- **Maintenance:** Track `latest` only; never ship canary/preview (e.g. 16.5.0-canary, 16.3.0-preview exist on the registry and are **not** used).

### 2.2 TypeScript 6.0.x, strict mode
- **Docs:** https://www.typescriptlang.org/docs/
- **Why 6.0.3 and not 7.0.2:** 7.0.2 is the registry `latest`, but `typescript-eslint@8.72.0` declares `typescript >=4.8.4 <6.1.0`. Adopting 7.x would break typed linting, a core quality gate. Revisit when typescript-eslint supports 7.
- **Alternatives:** TS 7 + Biome (drops typed-lint rules we want).

### 2.3 Tailwind CSS 4 + shadcn/ui
- **Docs:** https://tailwindcss.com/docs · https://ui.shadcn.com/docs
- **Why:** Tailwind logical utilities (`ms-*`, `ps-*`, `text-start`) make RTL/LTR a single codebase. shadcn copies accessible component source into the repo (no runtime lock-in); Radix primitives provide focus management and ARIA.
- **Alternatives:** React Aria Components 1.22.1 (excellent a11y/i18n, more assembly work); Base UI 1.9.0 (young). Reconsider in Stage 1 if any Radix component fails RTL checks.
- **Limitations:** Directional icons (chevrons/arrows) need explicit RTL mirroring; verified by e2e tests.

### 2.4 PostgreSQL 18 + Prisma 7
- **Docs:** https://www.postgresql.org/docs/ · https://www.prisma.io/docs
- **Why PostgreSQL:** transactions, constraints, `numeric` money, row-level features, JSONB for questionnaires, optional pgvector. 18.6 is current with EOL 2030-11-14.
- **Why Prisma 7.10.1:** mature versioned migrations (`prisma migrate`), typed client, wide Better Auth support. The `latest` npm tag points to **8.0.0-rc.23** (a release candidate) so we deliberately use the stable `7.10.1`.
- **Alternatives:** Drizzle ORM — `latest` is 0.45.4 and every 1.0 tag is beta/RC, so migrations/APIs are still moving; reconsider after 1.0 GA. Kysely + SQL migrations (more manual work).
- **Limitations:** Prisma lacks native CHECK constraints in schema DSL → added through raw SQL migrations and covered by tests. Money columns use `Decimal`.

### 2.5 Authentication — Better Auth
- **Docs:** https://www.better-auth.com/docs
- **Why:** Actively maintained, MIT, Next 16 + Prisma 7 peers declared, built-in email/password, sessions, 2FA plugin, RBAC-friendly.
- **Alternatives:** Auth.js/next-auth — `latest` is v4.24.15 (legacy line) and v5 is still tagged `beta`; Lucia-style hand-rolled sessions (more security surface to own); external IdP (Keycloak/Clerk) — adds a dependency not justified for v1 but kept as an upgrade path.
- **Limitations:** 1.x API still evolving — pin exact version, wrap behind `src/server/auth` so a swap is localized. Stage 2 includes a focused security review (cookie flags, session rotation, lockout, password hashing parameters).

### 2.6 Authorization — own RBAC matrix
- Roles → permissions mapped in code, enforced in the **server** data-access layer; UI hiding is cosmetic only. CASL (`@casl/ability` 7.0.2) is evaluated in Stage 2; adopted only if attribute-level rules (e.g. "technician sees only assigned projects") get complex.

### 2.7 Money and quotation arithmetic
- `numeric(14,2)` in PostgreSQL, `decimal.js` in code, no floating point. DZD rounding rule configurable and unit-tested. Quotation line values are **snapshotted** at issue time. The AI layer has no write access to any total.

### 2.8 Internationalization — next-intl
- **Docs:** https://next-intl.dev/docs
- Locale-prefixed routes (`/ar`, `/fr`), `dir` set on `<html>`, ICU messages, Arabic plural rules, Western digits by default (configurable). Default locale: **ar**.

### 2.9 AI layer
- **Docs:** https://ai-sdk.dev/docs
- Vercel AI SDK gives provider-independent calls and structured output (zod). It is wrapped by our own `AiProvider` interface so business code never imports a vendor SDK directly. Providers: Anthropic, OpenAI, Google, and OpenAI-compatible/local endpoints. RAG (pgvector) is decided in Stage 9 only if evaluation shows measurable gain over structured search.
- **Limitations:** SDK major versions move fast (7.x). Licenses of provider packages **TO VERIFY** before Stage 9.

### 2.10 PDF generation
- `@react-pdf/renderer` 4.9.0 is the first candidate. **Risk:** Arabic text shaping / bidi in react-pdf must be proven with an embedded Arabic font. Stage 5 starts with a spike; fallback is headless-Chromium HTML→PDF (Playwright is already a dev dependency; adds image weight).

### 2.11 Testing and quality
- Vitest 5 (unit/integration, real PostgreSQL via Compose/service container for DB tests), Playwright 1.64 (e2e, ar-RTL and fr-LTR projects) + axe-core, ESLint 10 + typescript-eslint 8.72 + Prettier 3.9. Biome 2.5.15 was considered (faster, one tool) but rejected for lacking the typed-lint and Next rule coverage we rely on.

### 2.12 Deployment
- Multi-stage Dockerfile (standalone output, non-root user, healthcheck), Compose for dev and prod profiles, Postgres volume, one-shot migration service, GitHub Actions for CI. No automatic production deploy.

## 3. Verified findings that shaped decisions

1. **Node.js:** endoflife.date lists v24 as LTS since 2025-10-28 with EOL 2028-04-30, and v26 entering LTS on 2026-10-28. nodejs.org's release table showed different EOL dates for v22/v24 in the page text we retrieved, so Stage 1 re-checks the schedule directly. Decision: **Node 24 LTS** (Node 26 is reconsidered once it is LTS and dependencies declare support). The local machine runs **22.22.0**, which still satisfies Prisma/Vitest engines, but Docker and CI will use 24 and developers should install 24.
2. **TypeScript 7** blocked by typescript-eslint (see §2.2).
3. **Prisma `latest` is an RC**; `prev` (7.10.1) is the stable line.
4. **Drizzle** stable line is pre-1.0; 1.0 only in beta/RC tags.
5. **Auth.js v5** is still beta; v4 is legacy.
6. **pnpm** and **psql** are not installed locally; Docker (28.1.1) is, so Postgres runs in a container.

## 4. Upgrade policy
- Weekly Dependabot/Renovate PRs for patch/minor, manual for majors. `pnpm audit` in CI. No beta/RC/canary in `main`. Each major upgrade gets an entry in this file.
