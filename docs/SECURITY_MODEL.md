# ServerWise — Security Model

## 1. Assets

Customer PII (names, phones, addresses), commercial data (prices, margins, contracts), infrastructure documentation about customers' networks (high sensitivity), credentials of staff, AI provider keys, backups.

## 2. Actors and threats (STRIDE-oriented)

| Threat                 | Examples                                          | Controls                                                                                                                                                      |
| ---------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spoofing               | Credential stuffing, session theft                | Strong password hashing (argon2id/scrypt per Better Auth config), rate limit + lockout, optional TOTP (mandatory for Admin), secure cookies, session rotation |
| Tampering              | IDOR, mass assignment, price manipulation         | Server-side authz on every service call, zod allow-list schemas, immutable quote snapshots, DB constraints                                                    |
| Repudiation            | "I never approved that discount"                  | Append-only audit log (actor, action, entity, before/after hash, IP, time)                                                                                    |
| Information disclosure | Leaking customer network details, secrets in logs | Least privilege roles, log redaction, no secrets in DB plaintext, error messages without internals                                                            |
| Denial of service      | Login brute force, expensive PDF/AI calls         | Rate limiting, request size caps, AI token/budget caps, timeouts                                                                                              |
| Elevation of privilege | Role escalation, prompt-injected AI actions       | Roles only changed by Admin (audited), AI tools execute with user's permissions and a risk gate                                                               |

## 3. Authentication and sessions

**Implemented in Stage 2** (code: `src/server/auth/`):

- Better Auth 1.7.11, email + password, DB-backed sessions. Passwords hashed with Better Auth's default scrypt; 12–128 characters. No password-breach lookup (it would send data to a third party).
- Cookies: `HttpOnly`, `SameSite=Lax`, prefix `serverwise`, and `Secure` whenever `APP_URL` is `https://` (the `__Secure-` prefix is then added by Better Auth). Sessions last 12 h and refresh hourly. Production must be served over HTTPS.
- **No self-registration.** `/sign-up/email`, `/admin/remove-user` and `/admin/impersonate-user` are disabled (404, covered by tests). Owners create accounts; the owner receives a random one-time temporary password (CSPRNG, 16 chars) and the account is flagged `mustChangePassword`. Until it is changed, every application page redirects to `/account`.
- **Lockout:** 5 consecutive wrong passwords lock the account for 15 minutes. Wrong password, unknown email and locked account all return the same message and status (no account enumeration). Counters reset on a correct password.
- **Rate limiting:** Better Auth limiter backed by PostgreSQL (survives restarts): sign-in 10/min, TOTP and backup-code verification 10/min, password change 5/min per client address.
- **TOTP 2FA** (Better Auth `twoFactor`): QR rendered locally (the secret never goes to a third party), 10 single-use backup codes, built-in 2FA attempt lockout. Owners must enrol before using the app when `REQUIRE_OWNER_2FA` is true (default in production).
- **CSRF:** Better Auth validates `Origin` against `APP_URL` + `AUTH_TRUSTED_ORIGINS` for cookie-bearing state-changing requests (verified against a production-mode server in e2e; Better Auth disables this check when `NODE_ENV=test`).
- Changing a password revokes every other session and issues a new one. Deactivating a user ends their sessions immediately.
- Telemetry from the auth library is disabled explicitly.
- Known limitation: sessions slide; there is no hard absolute lifetime cap yet (Stage 11).

## 4. Authorization

- Permission strings (`user:manage`, `audit:read`, …) mapped to the roles `owner`, `sales`, `technician`, `viewer` in one module (`src/server/authz/permissions.ts`); checked inside services with `assertCan` (never only in UI/middleware). Pages render the localized 404 for sections a user may not open.
- Resource-level rules where needed (e.g. Technician → assigned projects) arrive with their modules.
- Deny by default: unknown roles, forged role strings and missing sessions are refused.
- **Tested:** a hand-written golden matrix (role × permission) fails if a role is widened by accident; every user-management operation is asserted to reject anonymous callers and every non-owner role; real-session integration tests show a non-owner cannot reach Better Auth's admin API even if the service layer were bypassed.
- Business rules: an owner cannot change/deactivate their own account, and the last active owner cannot be demoted or deactivated.
- The admin endpoints of Better Auth are defence in depth: only the `owner` role holds admin statements.

## 5. Application security

- Input validation with zod at every boundary; output encoding by React; no `dangerouslySetInnerHTML` without sanitization.
- CSRF: Server Actions' origin checks + SameSite cookies; state-changing route handlers verify `Origin`.
- Security headers: CSP (nonce-based), HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, frame-ancestors none.
- File uploads (later): type/size allow-list, stored outside web root, never executed.
- SSRF: any server-side fetch of user-supplied URLs (e.g. supplier links) is disabled in v1; links are stored, not fetched.
- Dependency hygiene: lockfile, `pnpm audit` and CodeQL/Dependabot in CI, no install scripts from untrusted packages (`onlyBuiltDependencies` allow-list).

**Known accepted advisory (2026-10-20):** `braces <=3.0.3` (GHSA-vfj7-8cjw-p6xm, stack-exhaustion DoS, no patched version) reaches the project only through the dev dependency chain `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch`. It is lint tooling that never processes untrusted input and is not in the production image. `pnpm audit --prod` reports no vulnerabilities. Re-check at every dependency update; remove this note when a fix ships.

## 6. Data protection

- Single-business data model; no tenant isolation layer in v1 (documented non-goal). If multi-tenancy is introduced: tenant id on every row, enforced in the data-access layer, plus explicit cross-tenant tests.
- Minimum PII; documented retention; export/delete procedure for a customer (supports Algerian personal-data law obligations — legal review recommended).
- **Customer data (Stage 3):** CRM data is readable by owner, sales and technician (`crm:read`), writable by owner and sales (`crm:write`), and archivable only by the owner (`crm:archive`); viewers see nothing. Customers are archived, never deleted, so history survives; a true erasure request needs a documented owner-run procedure (planned with the retention policy in Stage 11). Audit rows reference customers by id and never copy phone numbers, e-mails or conversation text; log lines carry ids only. The conversation log is append-only (database trigger), so a wrong entry is corrected by a new entry. Free-text fields (notes, summaries) are rendered as text by React and limited in length. Phone numbers, e-mails and notes are the only personal data collected; no national ID numbers or credentials are stored.
- **Catalog data (Stage 4):** products and suppliers are readable and writable by owner, sales and technician (`catalog:read|write`); only the owner may verify or reject a price (`catalog:verify`); viewers see nothing. Supplier prices are immutable observations that require evidence (URL or quotation reference, enforced by a database CHECK) and an owner verification before the advisor uses them by default; verification is final and rows cannot be deleted (trigger). Saved recommendations are immutable snapshots (trigger). Product links accept only http/https URLs and are rendered as text/`rel="noopener noreferrer"` links. Supplier contact details are business contacts only; no credentials are stored.
- Encryption in transit (TLS); at rest via host disk encryption; DB backups encrypted (age/GPG) before leaving the host.
- **Secrets:** environment variables / Docker secrets only. `.env*` git-ignored; `.env.example` has placeholders. Customer credentials, VPN keys, Tailscale auth keys and SSH keys are **never stored** in ordinary tables; the app stores only references ("kept in customer's password manager, vault item X"). If storage becomes necessary, it requires envelope encryption with a KMS-style key outside the DB and a separate security review.

## 7. AI-specific controls

- Provider keys server-side only, never exposed to the client or prompts.
- Prompt-injection stance: retrieved text, logs, supplier pages and customer notes are **untrusted data**; they cannot change tool permissions or instructions.
- Tool risk classes: `read` (auto), `draft` (creates draft, reversible), `sensitive` (needs human confirmation with a diff of what will happen). Always-human list: deletions, production changes, access-control changes, public exposure, financial approvals, sending messages to customers.
- No tool exists for executing commands on customer infrastructure in v1.
- Data minimization: strip contact details unless needed; log tool calls (inputs hashed or redacted as configured); budget and rate caps per user.
- AI output is validated (zod) before use; failures degrade gracefully.

## 8. Remote access (Tailscale) policy

Documentation-only in v1. Guidance: customer-owned tailnet, ACLs by tag with least privilege, no subnet routers or exit nodes without a written plan, device approval enabled, key expiry kept on, no Funnel/public exposure by default. Check Tailscale plan terms for commercial use before relying on any free tier.

**Current deployment:** `compose.yml` publishes the app through tsdproxy v2 with the `tailscale_funnel` port option (public Funnel exposure), at the owner's explicit request. Since Stage 2 every application page requires sign-in; the only anonymous surface is the login form, `/api/health` (`{"status":"ok"}`), `/api/ready` (database up/down, no details) and the auth endpoints. Because the login form is reachable from the internet: keep lockout and rate limits enabled, require 2FA for owners (default in production), use a long unique `AUTH_SECRET`, and serve the public URL over HTTPS (`APP_URL=https://…`, added to `AUTH_TRUSTED_ORIGINS` if it differs). Remove `tailscale_funnel` from the label for tailnet-only access.

## 9. Logging, audit, monitoring

JSON logs (pino) with redaction of passwords, tokens, secrets, TOTP URIs, backup codes, cookies and `DATABASE_URL`/`AUTH_SECRET`.

**Audit log (Stage 2):** table `audit_log`, **append-only enforced by database triggers** that reject `UPDATE`, `DELETE` and `TRUNCATE` (tested). Rows carry actor id + email snapshot, action, entity, client address, user agent and metadata; there are no foreign keys, so history survives user deletion. Recorded now: sign-in success/failure/blocked, lockout, sign-out, password changed / reset by an owner, 2FA enrolment started/enabled/disabled/failed, user created, role changed, user deactivated/reactivated, settings changed (settings and their audit row commit in one transaction). Only owners can read it (`/audit`). Writes from auth hooks never block sign-in but failures are logged at error level; settings changes fail if the audit row cannot be written. The planned events: login success/fail, password/role change, quote issue/approve/discount, project state changes, exports, AI sensitive-action confirmations, settings changes. Alerts (later): repeated login failures, backup failure, expired restore tests.

## 10. Backup and recovery (summary; full runbook in Stage 8/11)

Nightly `pg_dump` (custom format) + WAL option, encrypted, retained 7 daily / 4 weekly / 6 monthly, copied off-host. Restore drill quarterly, result recorded in the app. Targets: RPO ≤ 24 h, RTO ≤ 4 h.

## 11. Security gates per stage

Each stage: threat review of new surfaces, authz tests, secret scan of diff, dependency audit, and notes in the stage report. Stage 11 adds an end-to-end security review and header/CSP verification.
