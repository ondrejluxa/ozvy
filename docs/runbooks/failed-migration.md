# A migration failed in production

Migrations are plain SQL in `supabase/migrations/`, applied in order by
`supabase db push`. CI applies every migration from scratch on each push (`supabase start`,
database tests) and on PGlite (`pnpm db:test:local`). A production failure therefore usually
means drift: data or an object in production that the local stack does not have.

## 1. Stop

- A failed migration runs inside a transaction and is rolled back, so the database stays on
  the previous version. Do **not** deploy the app version that needs the new schema.
- If the app was already deployed: roll back to the previous deployment on Vercel (Deployments →
  previous → Promote). If sending may be affected, use **Zastavit veškeré odesílání** on
  `/admin/system`.

## 2. Find the cause

```bash
supabase migration list --linked
```

Read the error from the `db push` output. Typical causes:

| Cause                                                          | Fix                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------- |
| A constraint fails on existing rows                            | Fix the data first in a separate, reviewed migration.   |
| An object already exists after manual changes in the dashboard | Never change the schema by hand.                        |
| A lock timeout on a busy table                                 | Run outside the sending window, or split the migration. |

## 3. Recover

1. Write a new migration that handles the data. Never edit a migration that is already applied
   anywhere.
2. Reproduce locally:
   1. `npx supabase db reset`;
   2. load a production-like dump if needed (see [restore-from-dump.md](restore-from-dump.md),
      into a scratch database);
   3. run `pnpm check` and `pnpm db:test`.
3. Push again and deploy the app.

## 4. If data was damaged

Restore from the latest nightly dump into a new project, compare, and copy back only the
damaged rows. See [restore-from-dump.md](restore-from-dump.md). Record everything.
