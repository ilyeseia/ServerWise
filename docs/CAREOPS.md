# ServerWise — Care operations: assets, tickets and maintenance

Code: `src/modules/careops` (`rules.ts` pure rules, `assets.ts`, `tickets.ts`, `maintenance.ts`,
`stats.ts`), `scripts/reminder-worker.ts`, and the `worker` service in `compose.yml`.

## 1. Assets (what is installed at a customer)

- An asset belongs to one customer for life: type (server, NAS, workstation, network device, UPS,
  software service, subscription, other), brand/model, **serial number**, OS and version,
  location, installation date, **warranty end** and **renewal date**, status (active, faulty,
  retired), and free notes.
- Serial numbers are unique **per customer** (a partial unique index); a blank serial is "none".
- An asset can point to the project that installed it, but only a project of the same customer
  (service check and database trigger).
- **Credentials are never stored.** `credentialsRef` only says where they are kept (for example
  "customer's password manager, item 12"); the form and the docs say so.
- Warranty and renewal dates are classified `ok` / `expiring` (≤ 30 days) / `expired` / `unknown` —
  an empty date is shown as _unknown_, never guessed.

## 2. Support tickets

```
open ─▶ in_progress ⇄ waiting_customer
  ╲          │              │
   ╰─────────▼──────────────▼──▶ resolved ─▶ closed (final)
                                    ╰─▶ in_progress (reopen)
```

- Numbers `T-YYYY-NNNN`, allocated atomically. Priority: low, normal, high, urgent (lists show the
  most urgent first).
- **Resolved needs a written resolution** (service rule and a CHECK). `closed` is final: nothing
  changes and nobody can comment (database trigger). An unwanted ticket may be closed from `open`.
- The discussion is **append-only** (trigger) — a wrong comment is corrected by a new one.
- A ticket's asset must belong to the same customer; assignees must be active staff.

## 3. Maintenance contracts and schedules

- A contract has a customer, a period, an optional monthly fee (exact decimal, DZD, never computed
  by AI), the assets it covers (same customer only) and notes. **Cancelling is final**, needs a reason
  and switches the contract's schedules off. State is computed from dates: scheduled / active /
  expired / cancelled.
- A schedule is a recurring visit: every _N_ months (1–60), first visit date, optional assignee.
  **Next visit** = the first visit date until one is done, then _N_ months after the **last visit**
  (end-of-month clamped: 31 Jan + 1 month = 28/29 Feb). Nothing falls due after the contract ends.
- State: **overdue** (before today), **due soon** (today … today + 7 days), **upcoming**, **finished**.

## 4. Visits (service reports)

- A report records what was done and which parts were replaced. It can be tied to a schedule, a
  ticket and/or an asset; all links must belong to one customer. It is **append-only** (trigger).
- Recording a visit for a schedule moves its next date forward, never backwards (an old visit
  entered late changes nothing), and closes the reminders it answers.

## 5. Reminders (the worker)

- `generateDueReminders()` creates one follow-up (the existing CRM follow-up list) for every visit
  that is overdue or due soon. **One reminder per schedule and due date** — a unique key makes the run
  idempotent, so running it twice, or from two processes at once, never duplicates.
- It runs in the `worker` Compose service (`pnpm worker:reminders`, every
  `REMINDER_INTERVAL_MINUTES`, default 60) and from a "generate now" button for people who manage
  maintenance. `pnpm worker:reminders --once` runs a single pass.
- The dashboard counts open and urgent tickets, overdue and due-soon visits, and warranties ending
  within 30 days, computed live from the data.

## 6. Permissions

| Permission            | owner | sales | technician | viewer |
| --------------------- | :---: | :---: | :--------: | :----: |
| `asset:read`          |   ✔   |   ✔   |     ✔      |   —    |
| `asset:write`         |   ✔   |   —   |     ✔      |   —    |
| `ticket:read`/`write` |   ✔   |   ✔   |     ✔      |   —    |
| `maintenance:read`    |   ✔   |   ✔   |     ✔      |   —    |
| `maintenance:write`   |   ✔   |   ✔   |     —      |   —    |
| `maintenance:perform` |   ✔   |   —   |     ✔      |   —    |

`maintenance:write` is the commercial side (contracts, schedules, generating reminders);
`maintenance:perform` is doing the work (recording visits). Every change is audited; reminders are
audited as the `system` actor.

## 7. Not in this stage

Spare-parts stock with quantities and prices, invoicing, SLA timers, e-mail or SMS notifications,
customer self-service, remote access plans and backups (Stage 8).
