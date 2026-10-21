# ServerWise — Backups and remote-access plans (customers' side)

Code: `src/modules/backups` (`rules.ts` pure rules, `service.ts`, `schemas.ts`). The runbook for
ServerWise's **own** database is [BACKUP_RESTORE.md](BACKUP_RESTORE.md).

**The application records and reminds; it never runs a backup, never connects to a customer system
and never stores a secret.** Encryption keys and credentials are referenced ("kept in the customer's
password manager, item 31"), never entered.

## 1. Backup policies

A policy belongs to one customer (and optionally one asset of that customer): what is backed up
(files, database, system image, configuration), **how often** (a successful backup is expected at
least every N days), retention, destination in words, whether it is encrypted / off-site (yes, no or
_unknown_ — never guessed), where the key is kept, and **how often a restore must be proven**
(default 90 days). Policies can be switched off; they are never deleted.

## 2. Health is computed, not typed

Two checks combine into one health (`rules.ts`):

| Backups (`backupStatus`)                                                       | Restores (`restoreStatus`)                                           |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| **failed** — the latest run failed                                             | **never_tested** — no restore has ever been proven                   |
| **overdue** — no success within interval + 1 day (new policies: from creation) | **failed** — the latest drill failed, even if an older one succeeded |
| **partial** — the latest run only partly worked                                | **overdue** — last proven restore older than the required interval   |
| **ok**, or **inactive** when switched off                                      | **ok**                                                               |

`critical` = a backup or a restore drill failed. `warning` = backups late/partial, **or a restore was
never proven / is overdue**. `ok` only when backups arrive **and** a restore has been proven
recently (**FR-9**: a backup nobody has restored is only a hope). Lists show problems first, and the
dashboard counts critical, warning and never-tested policies.

Entries are dated by day. When two entries share a day, the one entered last is the latest — so a
failed drill recorded after a successful one the same day is not hidden.

## 3. Runs and drills (append-only)

`BackupRecord` (when, success/partial/failed, size, notes) and `RestoreTest` (when, success/failed,
duration, notes) are append-only (database triggers); a wrong entry is corrected by a new one.
Neither can be dated in the future, and neither can be recorded on a switched-off policy.

## 4. Recovery documentation

Each policy carries step-by-step recovery instructions with a review date. Saving a changed
procedure counts as a review; "I reviewed it" confirms an unchanged one. It is **missing** when
empty, **stale** when not reviewed for a year, otherwise **ok**.

## 5. Remote-access (Tailscale) plans — documentation only

A plan records the customer, whose tailnet it is (customer-owned preferred), the connected devices,
the proposed ACL layout, and five safeguards from the security policy (device approval, key expiry,
no public exposure/Funnel, no subnet router or exit node, MFA). The safeguards default to **in
place**; ticking one off is a departure from the policy.

```
draft ──approve (owner)──► approved ──► retired
  └────────────────────────────────────► retired
```

- **Only the owner approves**, and only if the plan follows the policy **or every departure is
  explained in writing** (service rule and a database CHECK).
- A draft can be edited by the technician; an **approved plan is frozen** — it is retired and
  replaced by a new plan (trigger). Retired is final; plans are never deleted.

## 6. Permissions

| Permission       | owner | sales | technician | viewer |
| ---------------- | :---: | :---: | :--------: | :----: |
| `backup:read`    |   ✔   |   ✔   |     ✔      |   —    |
| `backup:write`   |   ✔   |   —   |     ✔      |   —    |
| `backup:record`  |   ✔   |   —   |     ✔      |   —    |
| `remote:read`    |   ✔   |   ✔   |     ✔      |   —    |
| `remote:write`   |   ✔   |   —   |     ✔      |   —    |
| `remote:approve` |   ✔   |   —   |     —      |   —    |

Every change is audited. Not in this stage: running or scheduling backups, alerts by e-mail/SMS,
automatic Tailscale changes.
