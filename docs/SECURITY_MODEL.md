# ServerWise — Security Model

## 1. Assets
Customer PII (names, phones, addresses), commercial data (prices, margins, contracts), infrastructure documentation about customers' networks (high sensitivity), credentials of staff, AI provider keys, backups.

## 2. Actors and threats (STRIDE-oriented)
| Threat | Examples | Controls |
|---|---|---|
| Spoofing | Credential stuffing, session theft | Strong password hashing (argon2id/scrypt per Better Auth config), rate limit + lockout, optional TOTP (mandatory for Admin), secure cookies, session rotation |
| Tampering | IDOR, mass assignment, price manipulation | Server-side authz on every service call, zod allow-list schemas, immutable quote snapshots, DB constraints |
| Repudiation | "I never approved that discount" | Append-only audit log (actor, action, entity, before/after hash, IP, time) |
| Information disclosure | Leaking customer network details, secrets in logs | Least privilege roles, log redaction, no secrets in DB plaintext, error messages without internals |
| Denial of service | Login brute force, expensive PDF/AI calls | Rate limiting, request size caps, AI token/budget caps, timeouts |
| Elevation of privilege | Role escalation, prompt-injected AI actions | Roles only changed by Admin (audited), AI tools execute with user's permissions and a risk gate |

## 3. Authentication and sessions
- Better Auth, email + password, DB-backed sessions; cookies `HttpOnly; Secure; SameSite=Lax`, `__Host-` prefix in production; idle + absolute timeouts; revoke-all on password change.
- No self-registration: users are invited/created by Admin.
- Login throttling per account and per IP; generic error messages.
- TOTP 2FA available from Stage 2; required for Admin.

## 4. Authorization
- Permission strings (`customer:read`, `quote:approve`, …) mapped to roles in one module; checked inside services (never only in UI/middleware).
- Resource-level rules where needed (e.g. Technician → assigned projects).
- Deny by default; a test enumerates every service function and asserts it rejects an unauthenticated and an unauthorized caller.

## 5. Application security
- Input validation with zod at every boundary; output encoding by React; no `dangerouslySetInnerHTML` without sanitization.
- CSRF: Server Actions' origin checks + SameSite cookies; state-changing route handlers verify `Origin`.
- Security headers: CSP (nonce-based), HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, frame-ancestors none.
- File uploads (later): type/size allow-list, stored outside web root, never executed.
- SSRF: any server-side fetch of user-supplied URLs (e.g. supplier links) is disabled in v1; links are stored, not fetched.
- Dependency hygiene: lockfile, `pnpm audit` and CodeQL/Dependabot in CI, no install scripts from untrusted packages (`onlyBuiltDependencies` allow-list).

## 6. Data protection
- Single-business data model; no tenant isolation layer in v1 (documented non-goal). If multi-tenancy is introduced: tenant id on every row, enforced in the data-access layer, plus explicit cross-tenant tests.
- Minimum PII; documented retention; export/delete procedure for a customer (supports Algerian personal-data law obligations — legal review recommended).
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

## 9. Logging, audit, monitoring
JSON logs with redaction (`authorization`, cookies, passwords, tokens). Audit events: login success/fail, password/role change, quote issue/approve/discount, project state changes, exports, AI sensitive-action confirmations, settings changes. Alerts (later): repeated login failures, backup failure, expired restore tests.

## 10. Backup and recovery (summary; full runbook in Stage 8/11)
Nightly `pg_dump` (custom format) + WAL option, encrypted, retained 7 daily / 4 weekly / 6 monthly, copied off-host. Restore drill quarterly, result recorded in the app. Targets: RPO ≤ 24 h, RTO ≤ 4 h.

## 11. Security gates per stage
Each stage: threat review of new surfaces, authz tests, secret scan of diff, dependency audit, and notes in the stage report. Stage 11 adds an end-to-end security review and header/CSP verification.
