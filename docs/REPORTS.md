# ServerWise — Analytics and reports

Code: `src/modules/reports` (`rules.ts` pure helpers, `service.ts` figures and CSV), the page
`/[locale]/reports` and the download `GET /api/reports/export`.

**Everything is computed live from the records.** Nothing is stored, estimated or hard-coded
(project rule: no decorative dashboards). Where there is nothing to average the report says
"no data"; it never shows an invented zero rate. The AI is not involved in any figure.

## 1. The period

`30d`, `90d` or `365d` (default 30), ending now. Anything else falls back to 30 days. The window is
`[now − N days, now)`. Figures that describe **the present** (leads by stage, open tickets, active
contracts, backup health) ignore the period; figures that describe **events** use it.

## 2. What is counted

| Section     | Figure                                   | Rule                                                                            |
| ----------- | ---------------------------------------- | ------------------------------------------------------------------------------- |
| Sales       | leads by stage                           | current status of every lead                                                    |
|             | won / lost, **win rate**                 | leads whose `closedAt` is in the period; rate = won ÷ (won + lost)              |
|             | quotations issued                        | revisions whose `issuedAt` is in the period (each revision counts)              |
|             | accepted / rejected, **acceptance rate** | revisions answered in the period; rate = accepted ÷ (accepted + rejected)       |
|             | issued / accepted value, **average**     | exact decimal sums of the revision totals (🔒 financial)                        |
| Operations  | projects by status                       | current                                                                         |
|             | completed, **average duration**          | `completedAt` in the period; days from creation to completion                   |
|             | open / **overdue tasks**                 | open tasks of open projects; overdue = due date before now                      |
| Support     | opened / resolved                        | `createdAt` / `resolvedAt` in the period                                        |
|             | **average resolution time**              | hours from opening to resolution, for tickets resolved in the period            |
|             | open now by priority                     | current                                                                         |
| Maintenance | active contracts, monthly fees           | in force today and not cancelled; fees are an exact sum (🔒 financial)          |
|             | overdue / due-soon visits                | same rule as the dashboard (due date before today / within 7 days)              |
|             | visits done                              | service reports performed in the period                                         |
| Backups     | policies, healthy, attention, critical   | same health rule as the backups module (a backup never restored is not healthy) |

Rates are shown with one decimal; money is exact (`decimal.js`, half-up, 2 decimals).

## 3. Who sees what

| Permission         | owner | sales | technician | viewer |
| ------------------ | :---: | :---: | :--------: | :----: |
| `report:read`      |   ✔   |   ✔   |     ✔      |   ✔    |
| `report:financial` |   ✔   |   ✔   |     —      |   ✔    |
| `report:export`    |   ✔   |   ✔   |     —      |   —    |

The viewer is the documented read-only "viewer / accountant": reports only, **including** the money
figures, and nothing else in the application. A technician sees every count but not the quotation
values or the monthly fees (they are replaced by nothing - the tiles are not rendered).

## 4. CSV export

`GET /api/reports/export?section=<quotes|tickets|projects|maintenance|backups>&range=<30d|90d|365d>&locale=<ar|fr>`

- Requires a signed-in user who passed the access gate and holds `report:export`; the permission is
  re-checked in the service. Unknown sections give 400, no session 401, no permission 403.
- UTF-8 **with a byte-order mark**, CRLF rows, headers in the requested language, served as an
  attachment with `Cache-Control: no-store`. The quotation total column is left out for a user
  without `report:financial`. At most 5 000 rows per file.
- **Formula injection:** a text cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return is
  written with a leading apostrophe, so a customer named `=HYPERLINK(...)` is text in Excel/Calc.
  Numbers are written as numbers. Tested with hostile customer and ticket names.
- **Every export is written to the audit log** (`report.exported`: who, which section and period,
  how many rows) - FR-11.

## 5. Testing

The figures are tested on data with known answers (integration tests create their own customers and
pass `customerIds`, an option that narrows every figure to those customers, so the checks are exact
on a shared database): for example quotations of 3001.00, 1000.00, 2000.50 and 500.00 give an issued
total of 6501.50, an accepted average of 1750.50 and an acceptance rate of 66.7 %; two tickets
resolved after 4 h and 8 h average 6.0 h; a project completed 5 days after creation averages 5.0 days.
Period boundaries, "no data" cases, permissions and the CSV are covered as well.

## 6. Not in this stage

PDF export of reports (use the browser's print), scheduled/e-mailed reports, charts beyond the
lead-stage bars, per-customer report pages, forecasts, and any figure computed by AI.
