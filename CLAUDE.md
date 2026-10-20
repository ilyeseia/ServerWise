# CLAUDE.md — ServerWise

Project: AI-powered server & infrastructure management platform for an Algerian server-installation/maintenance business. Repo: https://github.com/ilyeseia/ServerWise.git — work only in this directory (`C:\Users\seia\Desktop\esp-claw\ServerWise`); never create a nested project or second repo.

## Current state

Stage 0 published. Stage 1 (foundation) implemented, pending approval/publication. Layout: `src/app/[locale]` (pages), `src/i18n`, `src/server/{config,db,logging,health}`, `prisma/`, `messages/{ar,fr}.json`, `tests/{unit,integration,e2e}`. Read `docs/` first: PRODUCT_REQUIREMENTS, ARCHITECTURE, TECHNOLOGY_DECISIONS, SECURITY_MODEL, IMPLEMENTATION_ROADMAP.

## Mandatory workflow

1. Work **one stage at a time** (roadmap). Before starting: explain the stage to the user **in Arabic**.
2. Implement → verify (lint, typecheck, tests, build) → report in Arabic with real results → **stop and wait for approval**.
3. **Never `git push` without explicit user approval** for that stage. Never force-push or rewrite published history. Stage only intended files; scan the diff for secrets first; report the commit hash after pushing.
4. Never claim a check passed unless it actually ran and passed.

## Technical rules (planned stack)

- Next.js 16 App Router, TypeScript 6 strict, Tailwind 4 (logical properties only: `ms-/me-/ps-/pe-/text-start`), shadcn/ui, Prisma 7 + PostgreSQL 18, Better Auth, next-intl, zod.
- Layering: UI → server action/route handler (zod parse) → module service (**authorize first**) → repository (only place using Prisma).
- Money: `numeric(14,2)` + decimal.js, deterministic code only; **AI never computes totals, permissions, or approves anything.**
- No hardcoded demo stats in dashboards. No invented prices or availability — every offer needs a source and checked date.
- Every user-facing string exists in `ar` and `fr`.
- No beta/RC/canary dependencies on `main`. Pin exact versions; record decisions in `docs/TECHNOLOGY_DECISIONS.md`.
- Secrets only via env vars; never commit `.env*` (except `.env.example`), keys, dumps, or real customer data. Customer credentials/VPN keys are never stored in ordinary DB fields.

## Commit convention

`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:` — e.g. `feat: establish application foundation`.

## Local environment notes

Windows 10, PowerShell. Docker Desktop must be running (start it if `docker info` fails). Node installed is 22.22.0 (Docker/CI use 24). pnpm is not installed globally: run `npx --yes pnpm@12.14.0 <cmd>` (Corepack cannot run pnpm 12). No psql: use Postgres in Docker Compose (`compose.dev.yml`). ESLint is pinned to 9.x (see docs/TECHNOLOGY_DECISIONS.md). Messages are typed from `messages/ar.json`; keep `ar.json` and `fr.json` key-identical (a test enforces it).
