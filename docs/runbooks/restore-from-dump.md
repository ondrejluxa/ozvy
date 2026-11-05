# Restore from the nightly dump

**Targets** (spec §30): RPO 24 h, RTO 8 h in Phase 1–2.

**Backups:**

- Supabase daily backups (7 days);
- an independent nightly `pg_dump`, encrypted with age, in EU object storage with 30-day
  retention (`.github/workflows/backup.yml`).

## Drill (every quarter; locally on demand)

```bash
pnpm db:restore-drill
```

Locally it dumps the stack, restores into a fresh database, compares the row counts of every
public table, checks that RLS is enabled and forced, drops the copy, and appends the result to
[restore-drill-log.md](restore-drill-log.md).

In production, do the same against a new Supabase project:

1. Restore the dump (steps below).
2. Run `supabase test db` against the restored project.
3. Compare row counts with production.
4. Log the result in the drill log.

## Real restore

1. **Stop writes:** `/admin/system` → **Zastavit veškeré odesílání**, and put the app in
   maintenance (Vercel: promote a maintenance deployment, or pause the project).
2. **Get the dump:** download the newest `daily/navrat-*.dump.age` from the backup bucket and
   decrypt it with the offline age key:

   ```bash
   age -d -i ~/navrat-backup.key navrat-<time>.dump.age > navrat.dump
   ```

3. **New project:** create a fresh Supabase project in the EU (Frankfurt) and apply the
   migrations up to the version in the dump:

   ```bash
   supabase link --project-ref <new> && supabase db push
   ```

4. **Restore:** apply schema-owned objects first, then the data. Errors about existing
   platform objects (extensions, `supabase_*` roles) are expected.

   ```bash
   pg_restore --no-owner --data-only -d "$NEW_DB_URL" navrat.dump
   ```

5. **Re-apply erasures:** any deletion done after the dump time must be repeated before going
   live: data subject requests, `customer.opted_out` suppressions (the suppression list is in
   the dump, but later opt-outs are not) and the retention run (`pnpm jobs:retention` /
   Inngest).
6. **Verify:**
   1. `supabase test db`;
   2. row counts against the dump;
   3. sign in as an operator and as a shop user;
   4. `GET /api/health`.
7. **Switch:** point the Vercel environment variables (`NEXT_PUBLIC_SUPABASE_URL`, keys) to the
   new project, redeploy, then switch sending back on.
8. **Log:** record the incident and the data loss window (time of dump → time of failure).
   Tell the shops if campaign results changed.

Import files in Storage are temporary by design and not backed up.
