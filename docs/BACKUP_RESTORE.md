# ServerWise — Backing up and restoring ServerWise itself

This is the runbook for the application's own PostgreSQL database (customers, quotations, projects,
tickets, the audit log…). It is a **procedure for people**: the application does not back itself
up. The nightly dump (section 2) and the drill (section 4) were executed against a real instance:
dump → restore into a scratch database → compare tables, triggers and migrations → drop it. The
disaster restore (section 3) uses the same `pg_restore` into an empty database; its `--clean
--if-exists` flags only make a repeated restore safe, and the first full rehearsal on a new
machine is part of your first drill.

**Targets:** RPO ≤ 24 h (a dump every night), RTO ≤ 4 h. **Restore drill: every quarter**, and the
result recorded in the app (Backups → a policy for ServerWise itself, with a restore test).

## 1. What must be saved

| What                              | Where                         | How                                |
| --------------------------------- | ----------------------------- | ---------------------------------- |
| The database                      | the `db` container (`pgdata`) | `pg_dump` (below)                  |
| `.env` (`AUTH_SECRET`, passwords) | the server's project folder   | copy by hand to a password manager |
| The code                          | GitHub                        | `git clone` (nothing to back up)   |

Without `AUTH_SECRET` a restored database cannot verify existing sessions or two-factor secrets:
**keep it with the backups, in a different place from the dumps.**

## 2. Take a backup (every night)

```bash
mkdir -p backups
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "backups/serverwise-$(date +%F).dump"
```

- `-Fc` is the compressed custom format used by `pg_restore`.
- Encrypt before the file leaves the machine, for example with `age`:
  `age -r <public-key> -o backups/serverwise-$(date +%F).dump.age backups/serverwise-$(date +%F).dump`
  then delete the unencrypted copy. Keep the private key somewhere else.
- Copy the encrypted file **off the server** (another machine or storage). Keep 7 daily, 4 weekly
  and 6 monthly copies.
- Schedule it (cron or a systemd timer) and **look at the result**: a missing or tiny file is a
  failure. Record each run in the app.

## 3. Restore (disaster recovery)

1. Start only the database: `docker compose up -d db` (an empty volume on a new machine is fine).
2. Put the secrets back: the same `.env`, especially `AUTH_SECRET`.
3. Load the dump into the (empty) database:

   ```bash
   docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --clean --if-exists' < backups/serverwise-YYYY-MM-DD.dump
   ```

4. Start the rest: `docker compose up -d --build`. The `migrate` service applies any newer
   migrations; `/api/ready` must answer `{"status":"ready"}`.
5. Sign in, open the audit log and a recent customer, and confirm the data is what you expect.

## 4. The restore drill (quarterly) — never skip it

Do it on a **scratch database**, not on production. This exact sequence was verified:

```bash
# 1. dump
docker compose exec db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/drill.dump'
# 2. restore into a new database
docker compose exec db sh -c 'createdb -U "$POSTGRES_USER" drill_restore && pg_restore -U "$POSTGRES_USER" -d drill_restore --no-owner /tmp/drill.dump'
# 3. compare: same number of tables, triggers and applied migrations as production
docker compose exec db psql -U "$POSTGRES_USER" -d drill_restore -tAc "select count(*) from information_schema.tables where table_schema='public'"
docker compose exec db psql -U "$POSTGRES_USER" -d drill_restore -tAc "select count(*) from pg_trigger where not tgisinternal"
docker compose exec db psql -U "$POSTGRES_USER" -d drill_restore -tAc "select count(*) from _prisma_migrations"
# 4. clean up
docker compose exec db dropdb -U "$POSTGRES_USER" drill_restore
```

On the development database the restore reproduced all 42 tables, all 26 triggers (the append-only
audit log and the immutability rules came back intact) and all migrations. Then **record the drill in
the app**: Backups → the ServerWise policy → "Record a restore test", with how long it took and what
you checked. A drill that is not recorded did not happen.

## 5. After a restore: things to know

- Reminders are idempotent, so the worker will not duplicate follow-ups that already exist.
- Sessions older than the dump are gone; users sign in again.
- If `AUTH_SECRET` changed, two-factor secrets cannot be read: the owner must re-enrol (use
  `pnpm owner:create` for a new owner account if every owner is locked out).
