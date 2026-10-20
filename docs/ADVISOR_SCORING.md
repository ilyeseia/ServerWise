# ServerWise — Hardware Advisor: how a recommendation is made

Code: `src/modules/advisor` (`needs.ts`, `scoring.ts`, `service.ts`) and `src/modules/catalog`
(`freshness.ts`, `offers.ts`). Engine version: **1** (`ENGINE_VERSION`; bump it whenever scoring
behaviour changes — every saved recommendation records the version that produced it).

The advisor is **deterministic and does not use AI**. Same catalog + same answers = same result.
(In Stage 9 the AI copilot may _explain_ a result in prose; it never changes a score or a price.)

## 1. Principles

1. **No invented data.** A spec nobody entered is `unknown`. An unknown factor is not guessed: it
   does not move the score, and it lowers the _confidence_ of the product.
2. **No price without evidence.** Every price is an observation with a link or a quotation
   reference (enforced by the database), a date checked, a condition and — for it to be used — a
   verification by the owner.
3. **Explainable.** Every recommendation stores, per product and per factor: weight, verdict,
   score, and the numbers behind it (required vs available), plus the assumptions used and the
   products that were excluded and why.
4. **Immutable history.** A price change is a new observation. A saved recommendation is a
   snapshot and cannot be edited, so a quote can later cite exactly what was shown.

## 2. Which prices may be used

| State (today)  | Meaning                                       | Used by default |
| -------------- | --------------------------------------------- | --------------- |
| **fresh**      | verified, checked within **14 days**          | yes             |
| **stale**      | verified, 15–60 days old                      | only if asked   |
| **unverified** | recorded, nobody has confirmed the source yet | only if asked   |
| **expired**    | verified but older than **60 days**           | never           |
| **rejected**   | the owner determined the price is wrong       | never           |

- For each supplier only its **newest usable** observation counts (a newer price replaces an
  older one, even if it is dearer); across suppliers the **cheapest** is used.
- Thresholds are `DEFAULT_FRESHNESS` in `freshness.ts` (a deliberately short window: local retail
  and second-hand prices move quickly). They can become an owner setting later.
- Verification (`catalog:verify`) is **owner-only** and **final**: a wrong price is corrected by
  recording a new observation.

## 3. From answers to needs (`needs.ts`) — engineering assumptions

> **These figures are rules of thumb for sizing a small server, not measurements.** They are shown
> to the user as "assumptions" next to every recommendation and are meant to be reviewed and tuned.

Base system: 4 GB RAM, 2 000 CPU Mark points. Each workload adds:

| Workload          | RAM (GB) | CPU Mark | Per unit (answer)                        |
| ----------------- | -------- | -------- | ---------------------------------------- |
| file_storage      | 2        | 500      | —                                        |
| containers        | 2        | 1 000    | +0.25 GB, +60 per container (default 10) |
| home_automation   | 1        | 500      | +0.01 GB, +5 per device (default 30)     |
| virtualization    | 4        | 2 500    | +3 GB, +1 500 per VM (default 2)         |
| media             | 4        | 3 000    | —                                        |
| backup_target     | 2        | 500      | —                                        |
| surveillance      | 2        | 1 500    | +0.5 GB, +400 per camera (default 4)     |
| remote_access_vpn | 1        | 500      | —                                        |
| web_hosting       | 3        | 1 500    | —                                        |
| dev_test          | 6        | 4 000    | —                                        |
| other             | 2        | 1 000    | —                                        |

- Concurrent users add up to +8 GB (1 GB per 10 users) and up to +3 000 CPU Mark (50 per user).
- Growth factor ×1 / ×1.25 / ×1.5 (none / some / high). CPU priority ×0.9 / ×1 / ×1.4.
- RAM is rounded **up** to a standard size (4, 8, 16, 32, 64, 128, 256, 512 GB); a larger amount
  stated by the customer wins. CPU is rounded to 500 with a floor of 2 000.
- Storage: usable TB × growth × redundancy overhead (none 1, mirror 2, RAID 5 1.5, RAID 6 2) = raw
  TB needed; minimum drive slots 1 / 2 / 3 / 4.
- When a count the formula needs was not answered, the documented **default is used and listed as
  an assumption** ("defaulted").

CPU performance is compared using the public **PassMark CPU Mark** figure that staff copy into the
product, with the source link recorded next to it.

## 4. Scoring (`scoring.ts`)

Ten factors, each judged on a 0..1 scale from facts about the product (default weights, sum 100):

| Factor         | Weight | Judged by                                                               |
| -------------- | ------ | ----------------------------------------------------------------------- |
| performance    | 20     | CPU Mark ÷ required (capped at 1)                                       |
| ram            | 15     | installed ≥ required = 1; expandable to enough = 0.6; otherwise lower   |
| storage        | 15     | max capacity ÷ required raw TB; halved if there are too few drive slots |
| network        | 10     | fastest port ÷ required speed; ×0.7 if Wi-Fi is required but absent     |
| noise          | 10     | at/below wanted level = 1; one step louder = 0.5; more = 0              |
| budget         | 10     | within budget: 0.7 + 0.3 × (1 − price ÷ budget); over budget: excluded  |
| power          | 5      | explicit watt limit, else idle draw for a 24/7 server                   |
| gpu            | 5      | only if requested: dedicated 1, integrated 0.5, none 0                  |
| upgradeability | 5      | max RAM ÷ required (≥ 2× = 1, ≥ 1× = 0.6, else 0)                       |
| warranty       | 5      | depends on condition (new / refurbished / used) and months              |

Factors that do not apply (no GPU requested, no storage asked for, no budget...) are left out of
both sides of the average.

```
score      = Σ(weight × factor score) / Σ(weight)   over factors that could be judged  × 100
confidence = Σ(weight of judged factors) / Σ(weight of applicable factors)
adjusted   = score × (0.7 + 0.3 × confidence)           ← the ranking key
```

Ranking is by `adjusted`, then lower price, then name (stable and reproducible). The adjustment
means a product with missing data cannot beat a well-documented one on a lucky partial score.

**Hard limits** (the product is _excluded_ — still listed, with the reason): no usable price;
price above the maximum budget; the model's maximum RAM is below the requirement; the model's
maximum storage is below the requirement. A merely unknown upgrade path is **not** an exclusion.

## 5. Tuning

- Weights: `DEFAULT_WEIGHTS` (`scoring.ts`). Workload profiles and factors: `needs.ts`.
- Any change to behaviour must bump `ENGINE_VERSION` and update the golden tests in
  `tests/unit/advisor-scoring.test.ts` and `tests/unit/advisor-needs.test.ts` deliberately.
- Not modelled yet (candidates for later versions): power cost over time, rack/size constraints,
  vendor reliability, supplier reputation, delivery time.
