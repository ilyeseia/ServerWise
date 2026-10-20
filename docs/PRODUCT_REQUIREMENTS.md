# ServerWise — Product Requirements

**Tagline:** Smarter Servers. Better Decisions.
**Description:** AI-Powered Server & Infrastructure Management for a server-installation and IT-maintenance business in Algeria (Sétif and surrounding regions).

## 1. Context and assumptions
- Single business (one tenant) at launch; multi-tenancy is explicitly **out of scope** for v1 (see ARCHITECTURE §7 and SECURITY_MODEL §6).
- Primary language Arabic (RTL), secondary French (LTR). Currency DZD.
- Pricing figures in the brief (installation 10–50k DZD, maintenance 4–12k DZD/month) are **business assumptions**, stored as editable configuration — not market data.
- Remote access (Tailscale) is **documented and planned**, never auto-applied to customer networks in v1.
- The business works fully without the AI provider.

## 2. Users and roles (initial)
| Role | Purpose |
|---|---|
| Owner/Admin | Full access, settings, users, pricing, audit log |
| Sales | CRM, requirements, quotations (cannot approve discounts above a threshold) |
| Technician | Assigned projects, inventory, tickets, maintenance |
| Viewer/Accountant | Read-only reports |
Customer portal: **not in v1** (documents are exported as PDFs).

## 3. Release scope

### In scope for v1.0 (Stages 1–11)
| Module | Core capabilities |
|---|---|
| Foundation | Auth, RBAC, i18n ar/fr, light/dark, audit log, settings |
| A CRM | Customers (individual/business), contacts, preferred language, leads pipeline, follow-ups/reminders, communication log |
| B Questionnaire | Conditional, versioned questionnaire; answers stored against lead/customer |
| C Hardware advisor | Product catalog with specs, weighted scoring, explainable recommendation with per-criterion evidence |
| D Supplier catalog | Supplier, offer records: source URL, DZD price, condition, location, warranty, availability, **verification status, date checked**, freshness rules. Manual entry first; no scraping in v1 (see Risk R3) |
| E SmartQuote | Itemized quotes, taxes, discounts, margins, revisions, immutable snapshots, PDF (ar/fr), accept/reject workflow |
| F ProjectFlow | Quote → project, tasks, milestones, dependencies, test results, handover docs, rollback plans |
| G Inventory | Customer assets: hardware, OS, containers, services, network gear, subscriptions, versions |
| H CareOps | Tickets, contracts, preventive maintenance schedule, update records, renewals, service reports |
| I Remote access | Tailscale planning documents (per-customer tailnet, ACL notes), no automatic changes |
| Backups | Backup policies/records, restore-test tracking, recovery documentation |
| J AI copilot | Explain recommendations, draft quotes/plans, summarize history, log analysis; human approval for sensitive actions |
| K Analytics | Dashboards from real data only; exports (CSV/PDF) |

### Out of scope for v1
Customer self-service portal, payment processing, accounting/invoicing compliance (e.g. official Algerian fiscal invoicing), automatic scraping of marketplaces, agent software installed on customer machines, autonomous infrastructure changes, multi-tenant SaaS billing, mobile native apps.

## 4. Functional requirements (selected, testable)
- **FR-1** Every mutation requires authentication and a server-side permission check.
- **FR-2** All user-facing text for implemented workflows exists in ar and fr; missing key = failing test.
- **FR-3** Supplier offers older than a configurable freshness window (default 14 days) are shown as *stale* and excluded from recommendations unless explicitly included.
- **FR-4** A price or availability claim must reference a source (URL or manual quote ID) and a checked date; otherwise it cannot be marked *verified*.
- **FR-5** Quotation totals are computed by deterministic code; unit tests cover rounding, discounts, tax, and margin. Issued quotes are immutable; changes create a new revision.
- **FR-6** Quote acceptance creates a project once (idempotent) and records who/when.
- **FR-7** Project status transitions follow a defined state machine; illegal transitions rejected and tested.
- **FR-8** Maintenance schedules generate reminders; overdue items surface in dashboards.
- **FR-9** Restore-test records are first-class: last successful restore date per backup policy.
- **FR-10** AI actions classified `read`, `draft`, `sensitive`; `sensitive` always requires explicit human confirmation and is logged.
- **FR-11** Audit log for auth events, role changes, pricing/quote approvals, deletions, exports.
- **FR-12** Dashboards show only computed values; empty states instead of fake data.

## 5. Non-functional requirements
- **Security:** see SECURITY_MODEL.md. **Accessibility:** WCAG 2.2 AA target for core flows, axe checks in CI.
- **Performance:** list pages p95 < 500 ms server time on a small VPS with 10k customers; PDF generation < 5 s.
- **Reliability:** documented daily backup + tested restore; health endpoint; graceful AI degradation.
- **Deployability:** `docker compose up` on a single Linux host with 2 vCPU / 4 GB RAM.
- **Localization:** RTL/LTR parity, Arabic plural forms, date/number formatting per locale.

## 6. Success criteria for the Stage 11 release
All FR tested; CI green; recovery drill executed and documented; no high/critical dependency advisories; accessibility checks pass on core flows.

## 7. Risks
| ID | Risk | Mitigation |
|---|---|---|
| R1 | Arabic PDF shaping | Early spike in Stage 5, Chromium fallback |
| R2 | AI hallucinating prices/specs | AI never sets prices; answers cite catalog records |
| R3 | Legal/ToS limits on scraping Ouedkniss | Manual entry/links only until legal review |
| R4 | Tailscale commercial licensing | Customer-owned tailnets; documentation warns to check plan terms |
| R5 | Data protection (Algerian law 18-07 on personal data) | Minimize stored PII, access control, audit, retention policy; **legal review recommended** |
| R6 | Scope creep | Stage gates and explicit approvals |
