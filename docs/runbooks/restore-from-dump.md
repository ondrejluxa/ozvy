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
   live (spec §21, ADR-018):
   - **Erasure requests:** every completed erasure is in `data_subject_requests` with the
     customer's UUID in `subject_reference`.
     - Take the list from the old project if it is still readable. Otherwise use the audit log
       export, or the operator's own notes for requests completed after the dump.
     - In the SQL editor of the restored project (as `postgres`), for each one:

       ```sql
       -- one row per completed erasure; app.erase_customers redacts messages,
       -- deletes raw import rows and the customer (no-op if already gone)
       select app.erase_customers('<company_id>'::uuid, array['<customer uuid>'::uuid]);
       ```

     - The requests completed before the dump re-apply themselves with:

       ```sql
       select r.company_id, app.erase_customers(r.company_id, array[r.subject_reference::uuid])
       from public.data_subject_requests r
       where r.type = 'erasure' and r.status = 'completed'
         and exists (select 1 from public.customers c where c.id = r.subject_reference::uuid);
       ```

   - **Opt-outs:** `customer.opted_out` suppressions. The suppression list is in the dump, but
     later opt-outs are not; replay them from the gateway's STOP replies or the old project.
   - **Retention:** run the nightly retention (`pnpm jobs:retention` / Inngest).
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
