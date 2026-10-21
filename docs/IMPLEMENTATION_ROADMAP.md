# ServerWise — Implementation Roadmap

Workflow for **every** stage: explain (Arabic) → implement → verify (lint, types, tests, build) → report (Arabic) → **wait for approval** → publish to GitHub only after explicit approval. Never force-push.

| Stage | Name                             | Main deliverables                                                                                                                                                                                                            | Acceptance (summary)                                                                                             | Depends on             |
| ----- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 0     | Discovery & blueprint            | These docs                                                                                                                                                                                                                   | Docs consistent, versions sourced                                                                                | —                      |
| 1     | Application foundation           | Next 16 + TS 6 + Tailwind 4 + shadcn; next-intl ar/fr with RTL/LTR; Prisma 7 + Postgres 18 via Compose; env validation (zod); pino; health/ready endpoints; ESLint/Prettier/Vitest/Playwright; Dockerfile; GitHub Actions CI | `pnpm lint/typecheck/test/build` green; e2e shows ar-RTL and fr-LTR shell; `docker compose up` healthy; CI green | 0                      |
| 2     | Auth & access control            | Better Auth, invite-only users, roles/permissions, 2FA (TOTP), audit log, settings, rate limiting                                                                                                                            | Authz test matrix; session/cookie checks; lockout; audit entries                                                 | 1                      |
| 3     | CRM & questionnaire              | Customers, contacts, leads pipeline, follow-ups, communications; versioned conditional questionnaire                                                                                                                         | CRUD + permission tests; conditional logic tests; ar/fr e2e                                                      | 2                      |
| 4     | Hardware & suppliers             | Product catalog, specs, suppliers, offers with verification/freshness, scoring engine, explainable advisor                                                                                                                   | Scoring unit tests; freshness tests; no unsourced price accepted                                                 | 3                      |
| 5     | SmartQuote                       | Pricing config, deterministic calc, quotes/revisions/snapshots, PDF ar/fr (after spike), accept workflow                                                                                                                     | Arithmetic/rounding tests; immutable snapshots; PDF renders Arabic correctly                                     | 4                      |
| 6     | ProjectFlow                      | Quote→project, tasks, checklists, milestones, dependencies, handover, rollback                                                                                                                                               | State-machine tests; idempotent creation                                                                         | 5                      |
| 7     | Inventory & maintenance          | Assets, services, tickets, contracts, schedules, reminders worker                                                                                                                                                            | Scheduling tests; ticket lifecycle                                                                               | 6 (assets also feed 3) |
| 8     | Backups & remote-access planning | Backup policies/records, restore tests, recovery docs, Tailscale plans                                                                                                                                                       | Restore-test tracking tests; docs reviewed                                                                       | 7                      |
| 9     | ServerWise AI                    | Provider config, gateway, tools + risk gate, structured outputs, optional RAG                                                                                                                                                | Provider-failure tests; injection tests; no tool alters totals                                                   | 4–8                    |
| 10    | Analytics & reporting            | Dashboards from real data, exports                                                                                                                                                                                           | Query correctness tests against seeded fixtures                                                                  | 5–8                    |
| 11    | Production hardening             | Security review, a11y audit, perf, backup/restore drill, release docs                                                                                                                                                        | Drill executed; audit clean; release checklist                                                                   | all                    |

## Status

| Stage | State                                                              |
| ----- | ------------------------------------------------------------------ |
| 0     | Published (`2275845`)                                              |
| 1     | Published (`a1ce34d`), deployed and verified on the Docker host    |
| 2     | Approved and published (authentication, RBAC, audit log, settings) |
| 3     | Approved and published (CRM, requirements questionnaire)           |
| 4     | Approved and published (`bb87359`; catalog, suppliers, advisor)    |
| 5     | Approved and published (`3aa41ce`; quotations)                     |
| 6     | Approved and published (`2e52fbd`; ProjectFlow)                    |
| 7     | Approved and published (`dc31efb`; assets, tickets, maintenance)   |
| 8     | Implemented, pending approval (backups, remote-access plans)       |
| 9–11  | Not started                                                        |

## Cross-cutting each stage

Update docs and `CLAUDE.md`; add tests for new rules; migrations reviewed; secret scan; `pnpm audit`; Arabic + French strings for every shipped screen.

## Open decisions for the owner (to resolve by the stage noted)

1. Hosting model: VPS abroad vs in-country vs on-prem (Stage 1/11). 2. Official tax/VAT rules and invoicing needs (Stage 5). 3. Legal stance on marketplace data (Stage 4). 4. Preferred AI provider(s) and budget (Stage 9). 5. Numeral style in Arabic UI: Western (0-9) vs Arabic-Indic (Stage 1). 6. Brand/logo assets for PDFs (Stage 5).

## Prerequisites to install before Stage 1

Node.js 24 LTS (Stage 1 verified on 22.22.0 locally and 24 in Docker/CI); pnpm 12.14.0 installed through npm (not Corepack); Docker 28 and Git.
