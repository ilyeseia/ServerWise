# ServerWise — Quotations (SmartQuote): how a quote is calculated and frozen

Code: `src/modules/quotes` (`calc.ts` pure arithmetic, `pricing.ts` configuration, `service.ts`
workflow). Calculation version: **1** (`CALC_VERSION`; every issued quotation records it — bump it
whenever the arithmetic changes).

**Money is never computed by AI.** Totals come only from the deterministic calculator below; the
browser editor runs the same function for a live preview, but the server recomputes and its result
is what is stored.

## 1. Arithmetic (`calc.ts`)

All amounts are exact decimals (`decimal.js`, stored as `numeric(14,2)`), exchanged as strings, never
floats. Rounding is **half-up at 2 decimals**, applied at fixed points:

```
gross      = round(quantity × unitPrice)
net        = round(gross × (100 − discountPct) / 100)
discount   = gross − net
tax        = round(net × taxRatePct / 100)          (per line)
subtotal   = Σ net          taxTotal = Σ tax          total = subtotal + taxTotal
```

Because every line is rounded before summing, the totals always add up exactly (a database CHECK
also enforces `total = subtotal + tax`). Limits: quantity > 0 with up to 3 decimals; price ≥ 0 with
up to 2; discount and tax between 0 and 100; every amount must fit `numeric(14,2)`. Malformed
input (`1e3`, `1,5`, `NaN`, too many decimals) is rejected, not coerced.

**Margin** = subtotal − Σ(quantity × unitCost), computed **only if every line has a known cost**;
otherwise it is shown as _unknown_ (a missing cost is never treated as zero).

## 2. Nothing is invented

- **Tax rates** are entered by the owner in _Settings → Pricing_. There is no default rate. Only
  `0` and the configured rates can be used on a line.
- **Markup**, **minimum margin** and **hourly labour rate** are optional owner settings; empty means
  "not configured". Without a markup the selling price of a catalogue product is typed by staff.
- **Hardware cost** comes from a supplier price observation (Stage 4) that is verified and fresh
  _when the line is saved and again when the quotation is issued_; the client cannot supply it.

## 3. Lifecycle

```
draft ──issue──► issued ──► accepted        (final)
                   │   ├──► rejected        (a new revision may follow)
                   │   └──► superseded      (when a newer revision is issued)
                   └── expires by date (computed; no job): "expired"
```

- A quote (number `Q-YYYY-NNNN`, allocated atomically per year) belongs to a lead and holds numbered
  **revisions**. At most one draft and at most one accepted revision per quote (partial unique indexes).
- **Issuing** requires ≥ 1 line, re-checks every supplier price, applies the minimum-margin rule
  (below it only the owner may issue), then freezes a **snapshot** (company, customer, lines, price
  evidence, calculation, version, validity) and the totals. From then on the database refuses any
  change to the revision's content or lines (triggers); a change is a **new revision** that copies
  the latest one.
- **Recording the answer** (accepted / rejected) is final and is refused after the validity date.
- Every step writes an audit row in the same transaction.

## 4. Permissions

| Permission     | owner | sales | technician | viewer |
| -------------- | :---: | :---: | :--------: | :----: |
| `quote:read`   |   ✔   |   ✔   |     ✔      |   —    |
| `quote:write`  |   ✔   |   ✔   |     —      |   —    |
| `quote:issue`  |   ✔   |   ✔   |     —      |   —    |
| `quote:decide` |   ✔   |   ✔   |     —      |   —    |

The pricing configuration is governed by `settings:read` / `settings:update` (owner). Costs and
margins are shown only to users who can write quotes; the customer's copy never shows them.

## 5. The customer's document (PDF)

The printable page (`/quotes/[id]/print`) is built from the **frozen snapshot** and uses the
browser's _Save as PDF_. Rationale: the browser shapes Arabic correctly (joined letters, RTL, mixed
Latin/Arabic), whereas JavaScript PDF libraries that draw text themselves do not reliably. A
server-generated PDF (headless Chromium) is deferred: it would add a browser to the production image
and needs a decision on image size — see `docs/TECHNOLOGY_DECISIONS.md`.
