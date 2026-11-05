# Production deploy

Production is not deployed from this repository yet. It needs accounts and credentials that
only the owner can create. This is the checklist for the first deploy and for every later one.

## One-time setup (owner)

1. **Supabase:** new project in EU (Frankfurt), Pro plan (daily backups).
   - Auth: e-mail sign-up disabled (invite-only), TOTP MFA enabled, SMTP set to the
     transactional e-mail provider, site URL set to the app URL, e-mail templates from
     `supabase/templates/`.
   - Storage: buckets are created by the migrations (private).
   - `supabase link --project-ref <ref>` then `supabase db push`.
2. **Vercel:** import the repository, framework Next.js, region `fra1`. Set the environment
   variables (production):

   | Variable                                                                                 | Value                                                            |
   | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
   | `APP_ENV`                                                                                | `production`                                                     |
   | `DATA_SOURCE`                                                                            | `supabase`                                                       |
   | `NEXT_PUBLIC_APP_URL`                                                                    | the app's URL                                                    |
   | `OPT_OUT_BASE_URL`                                                                       | the short opt-out domain + `/o`                                  |
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | from the Supabase project                                        |
   | `SUPPRESSION_PEPPER`                                                                     | 32+ random bytes; generate once, never rotate without re-hashing |
   | `JOB_RUNNER`                                                                             | `inngest`                                                        |
   | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`                                               | from Inngest                                                     |
   | `SMS_PROVIDER`                                                                           | `bulkgate`                                                       |
   | `SMS_PROVIDER_API_KEY`, `SMS_PROVIDER_API_SECRET`                                        | BulkGate application ID and token                                |
   | `SMS_WEBHOOK_SECRET`                                                                     | 32+ characters                                                   |
   | `SMS_PRICE_PER_SEGMENT_MINOR`                                                            | CZK haléře per segment                                           |
   | `SMS_RATE_PER_SECOND`                                                                    | dispatcher rate limit                                            |
   | `EMAIL_PROVIDER`, `SMTP_URL`, `EMAIL_FROM`                                               | transactional e-mail                                             |
   | `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`                                                  | an EU or zero-retention provider, listed as a sub-processor      |
   | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`                                                   | Sentry project in the EU region                                  |

   The app refuses to start when a production requirement is missing (`lib/env/schema.ts`).

3. **Inngest:** connect the Vercel project. The functions are served at `/api/inngest`:
   - messaging tick (every minute);
   - health check (every 15 minutes);
   - lifecycle (03:00);
   - stats (03:30);
   - retention (04:00);
   - digest (06:00);
   - event-triggered jobs.
4. **BulkGate:** delivery report URL
   `https://<app>/api/webhooks/sms/bulkgate?secret=<SMS_WEBHOOK_SECRET>`. Register the
   alphanumeric sender IDs.
5. **Short opt-out domain:** point it at Vercel. Only `/o/*` is needed.
6. **Backups:** create the bucket (EU, 30-day lifecycle), an age key pair (private key offline),
   and the GitHub environment `production` with the secrets listed in
   `.github/workflows/backup.yml`. Run the workflow once by hand, then do the first restore
   drill.
7. **Monitoring:** an uptime monitor on `GET /api/health` (1 minute) and on the opt-out page;
   Sentry alerts to e-mail.
8. **First operator:** `pnpm admin:create` is for the local stack only. Invite the
   operator through Supabase Auth, insert the `platform_admins` row in the SQL editor, then
   enrol TOTP on first sign-in.

## Every deploy

1. CI is green on `main`: typecheck, lint, unit, database tests, end-to-end on the demo and on
   Supabase.
2. `supabase db push`, migrations first. They are additive; never edit an applied migration.
3. Merge or promote on Vercel. Check `GET /api/health`, sign in as the operator, and look at
   Attention Required.
4. Outside the sending window if a migration touches `messages`, `campaigns` or
   `campaign_enrollments`.

## Rotate secrets

| Secret                                            | How                                                                                                                                                 |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SMS_WEBHOOK_SECRET`                              | Set the new value in Vercel and redeploy, then change the BulkGate callback URL. Callbacks with the old secret are refused (401); BulkGate retries. |
| `SMS_PROVIDER_API_SECRET`                         | Regenerate the token in BulkGate, set it in Vercel, redeploy.                                                                                       |
| `SUPABASE_SERVICE_ROLE_KEY`                       | Rotate the JWT secret in Supabase (this signs everyone out), update the keys in Vercel, redeploy.                                                   |
| `INNGEST_SIGNING_KEY`, `AI_API_KEY`, `SENTRY_DSN` | Replace in Vercel and redeploy.                                                                                                                     |
| `SUPPRESSION_PEPPER`                              | Do not rotate. Only after a leak, and only with a migration that re-hashes every number.                                                            |
