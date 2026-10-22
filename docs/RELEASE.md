# ServerWise — Release, upgrade and rollback

This is the checklist for putting a version on the server and for undoing it. It was written in
Stage 11 and every command below was exercised during that stage (the results are in §6).

## 1. What a release contains

| Part              | Where                         | Notes                                                           |
| ----------------- | ----------------------------- | --------------------------------------------------------------- |
| Application image | `Dockerfile`, target `runner` | non-root user, read-only filesystem, all capabilities dropped   |
| Migrations        | `prisma/migrations` (10)      | applied by the one-shot `migrate` service before the app starts |
| Worker            | `worker` service              | reminder worker, same code, no published port                   |
| Configuration     | `.env` (never committed)      | see `.env.example`; secrets only here                           |

Versions of everything are pinned (`docs/TECHNOLOGY_DECISIONS.md`); there are no beta or canary
dependencies.

## 2. Before releasing (on the development machine)

Run all of these; a release is only as good as the last green run.

```bash
npx --yes pnpm@12.14.0 exec prettier --check .
npx --yes pnpm@12.14.0 exec eslint .
npx --yes pnpm@12.14.0 exec tsc --noEmit
npx --yes pnpm@12.14.0 audit --prod --audit-level=high
npx --yes pnpm@12.14.0 exec vitest run          # needs the Postgres of compose.dev.yml
npx --yes pnpm@12.14.0 exec next build
npx --yes pnpm@12.14.0 exec playwright test      # all projects (desktop + mobile)
git status --ignored --short                     # every new source folder must be tracked
```

Then: scan the diff for secrets, confirm that CI is green on the pushed commit, and tag it
(`git tag -a vX.Y.Z -m "..."` — only after the owner approved).

## 3. Deploying on the server

```bash
git pull
docker compose up -d --build
docker compose ps                                  # db healthy, migrate exited 0, app + worker up
curl -fsS http://127.0.0.1:3000/api/ready          # {"status":"ok", ...}
```

First installation only: copy `.env.example` to `.env`, set `POSTGRES_PASSWORD` and `AUTH_SECRET`
(`openssl rand -base64 32`), `APP_URL` (the public `https://` address), then create the owner:

```bash
docker compose run --rm migrate pnpm owner:create --email you@example.com --name "Your Name"
```

The app listens on `127.0.0.1:3000` only. Public access goes through a TLS reverse proxy you run
(Caddy, Nginx, ...) or an SSH tunnel; there is no proxy or Tailscale network wired into the compose file. `Strict-Transport-Security`
is sent by the application; the database is never published.

## 4. Upgrading safely

1. **Take a backup first** (runbook: `docs/BACKUP_RESTORE.md`):
   `docker compose exec db pg_dump -U serverwise -d serverwise --format=custom -f /tmp/pre-upgrade.dump`
   and copy it off the host (`docker compose cp db:/tmp/pre-upgrade.dump .`).
2. `git pull && docker compose up -d --build`. The `migrate` service runs `prisma migrate deploy`;
   the `app` and `worker` services wait for it to finish successfully, so a failed migration stops
   the deployment (check `docker compose ps` and `docker compose logs migrate`).
3. Check `/api/ready`, sign in, open the dashboard and the reports page.
4. Migrations in this project only **add** (tables, columns, indexes, constraints); none drops data.

## 5. Rolling back

- **Code only (no new migration):** `git checkout <previous-tag>` then `docker compose up -d --build`.
- **With a migration:** the new indexes/columns are harmless to old code, so rolling the code back is
  normally enough. If a migration itself must be undone, restore the pre-upgrade dump into a new
  database, point `DATABASE_URL` at it, and keep the failed database for analysis:

```bash
docker compose exec db createdb -U serverwise serverwise_restored
docker compose exec db pg_restore -U serverwise -d serverwise_restored --no-owner /tmp/pre-upgrade.dump
```

Never drop the failed database before the owner has looked at it. The audit log is append-only by
database triggers, so a restore is the only way to "go back" and it keeps the log as it was.

## 6. Verified in Stage 11

| Check                                                                                      | Result                                                                                                                                                         |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh database gets all 10 migrations, and the schema has no drift (`prisma migrate diff`) | no difference                                                                                                                                                  |
| Dump → restore into an empty database → compare                                            | 27 triggers, 79 CHECK constraints, 128 indexes, 10 applied migrations and every table count identical; the audit log is still append-only in the restored copy |
| Content-Security-Policy                                                                    | nonce per request on all 18 screens in both languages, no violation, an injected inline handler does not run                                                   |
| Accessibility (axe WCAG 2.2 AA)                                                            | 18 screens × 2 languages × desktop and mobile: no violation, no sideways overflow                                                                              |
| Report queries on 80 000 tickets / 20 000 revisions / 40 000 leads                         | 18–60 ms before the report indexes, 1–6 ms after (migration `20261029000000_report_indexes`)                                                                   |

The drill used the development database (small data). Repeat it on the real server after the first
month of use and after any large import; record the date in the backups module.

## 7. Known limits (deliberate)

- The AI assistant has been tested against a fake provider only; try it with the real key on a copy
  before relying on it.
- PDF output is the browser's print dialog.
- The `worker` runs from the build image as root inside a container with all capabilities dropped and
  `no-new-privileges`; it has no published port. A slimmer non-root worker image is a possible later step.
- Sign-in and two-factor attempts are rate limited (10 per minute per client, 100 for other
  authentication calls), stored in the database so it holds across restarts and replicas. The
  other pages and server actions are not rate limited; they all require a signed-in user.
- The compose file publishes the app on localhost only; TLS termination and public exposure are up to the operator.

## 8. Change history (by stage)

| Stage | Delivered                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------ |
| 0     | Blueprint and docs                                                                               |
| 1     | Foundation: Next.js, i18n ar/fr (RTL/LTR), Prisma/PostgreSQL, Docker, CI                         |
| 2     | Authentication, roles and permissions, 2FA, audit log, settings                                  |
| 3     | CRM, leads, follow-ups, requirements questionnaire                                               |
| 4     | Hardware catalog, suppliers and offers with evidence, explainable advisor                        |
| 5     | Quotations: exact arithmetic, immutable issued revisions, printable view                         |
| 6     | Projects: tasks, checklists, dependencies, handover                                              |
| 7     | Assets, tickets, maintenance contracts, reminder worker                                          |
| 8     | Backup policies, restore drills, remote-access plans                                             |
| 9     | Optional AI assistant with read-only tools and guardrails                                        |
| 10    | Analytics and audited CSV reports                                                                |
| 11    | Production hardening: nonce-based CSP, accessibility sweep, report indexes, drill, this document |
