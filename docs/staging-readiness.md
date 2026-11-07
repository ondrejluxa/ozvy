# Staging readiness (before the first real pilot)

Nothing here has been created yet. No real credentials are in the repository or were used.
Staging and production are separate copies of everything below: separate Supabase
projects, Vercel environments, Inngest environments, BulkGate applications and Sentry
environments. Staging runs `APP_ENV=staging`, which allows the real gateway only for
`SMS_TEST_WHITELIST` numbers (the app refuses to start otherwise).

## 1. Order of setup

Do these in order. Each step needs values from the steps before it.

1. **GitHub:** push the repository to a private repo. Enable Actions and confirm that CI
   (`.github/workflows/ci.yml`) is green on `main`. Protect `main` (CI required).
2. **Domains:** choose the app domain (e.g. `app.<brand>.cz`, staging `staging.<brand>.cz`) and
   a short opt-out domain (e.g. `<short>.cz`). Keep DNS where you can add records for
   e-mail and Vercel.
3. **Supabase staging project:** EU (Frankfurt), Pro plan.
   - `supabase link`, then `supabase db push` (all migrations).
   - Apply the auth settings (section 4) and check them.
4. **E-mail provider** (EU, SMTP):
   - verify the sending domain (SPF, DKIM, DMARC);
   - create SMTP credentials;
   - put them into the Supabase Auth SMTP settings (password-reset e-mails) and into
     `SMTP_URL` (app e-mails: invitations, approvals, operator digest).
5. **Sentry:** one project in the EU region (`*.de.sentry.io`), with environments `staging` and
   `production`. Copy the DSN.
6. **Vercel** (Pro, needed for the 300 s function limit):
   - import the repo, functions region `fra1`;
   - add the staging domain and the opt-out domain;
   - set the environment variables (section 3) for the staging environment.
7. **Inngest:** create the account and install the Vercel integration (it sets
   `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`). Use a separate Inngest environment for
   staging. Sync the app at `https://<staging>/api/inngest` and check that all 12 functions
   appear.
8. **BulkGate:**
   - create a separate application for staging and note its `application_id` and token;
   - request the alphanumeric sender ID;
   - top up a little credit;
   - set the delivery report URL to
     `https://<staging>/api/webhooks/sms/bulkgate?secret=<SMS_WEBHOOK_SECRET>`;
   - for inbound STOP replies, set up a reply-capable sender (see section 2, BulkGate);
   - put your own phone(s) into `SMS_TEST_WHITELIST`.
9. **Backups:**
   - create an EU bucket with a 30-day lifecycle (Cloudflare R2 with EU jurisdiction, or S3
     `eu-central-1`) and a token scoped to that bucket;
   - generate the age key pair offline (`age-keygen`) and keep the private key offline;
   - add the GitHub environment `production` (later also for staging) with the `BACKUP_*`
     secrets;
   - run `Nightly backup` by hand, then do a restore drill
     (`docs/runbooks/restore-from-dump.md`).
10. **Uptime monitoring:** `GET https://<staging>/api/health` every minute; the opt-out domain
    separately.
11. **First operator:**
    - invite the operator through Supabase Auth (dashboard → Users → Invite);
    - insert the `platform_admins` row in the SQL editor;
    - sign in and enrol TOTP.

    Then create the test shop and its owner from the app.

12. **Pilot test:** run `docs/pilot-test-checklist.md` with your whitelisted phones.
13. **Production:** repeat steps 3–11 with production projects and secrets, with
    `APP_ENV=production` and no whitelist, only after the pilot test passes.

## 2. Checklist by service

### Supabase EU project

- [ ] Project in EU (Frankfurt), Pro plan (daily backups; leaked-password protection is
      available).
- [ ] `supabase db push` applied every migration; `supabase migration list --linked` shows none
      missing.
- [ ] Run the database tests against staging once (`supabase test db --linked`). They roll
      back.
- [ ] Auth settings recreated (section 4). Site URL and redirect URLs point to the staging
      domain.
- [ ] Auth SMTP set; a password-reset e-mail arrives and its link works (`/auth/confirm`).
- [ ] API "Max rows" left at 1,000; exposed schemas `public`, `graphql_public` only (the
      `app` schema must not be exposed).
- [ ] Storage: buckets `imports` and `company-documents` exist and are private (created by
      the migrations).
- [ ] Service-role key known only to Vercel; never in the browser or in the repo.

### Vercel deployment

- [ ] Pro plan (`/api/inngest` declares `maxDuration = 300`).
- [ ] Functions region `fra1`. Node.js 24.
- [ ] Staging domain and opt-out domain attached, HTTPS active.
- [ ] Environment variables complete (section 3). The app refuses to boot on a missing or
      placeholder value, so check the first deployment's logs.
- [ ] `GET /api/health` returns `{"status":"ok","db":"ok"}`.
- [ ] Response headers present (CSP, HSTS, `X-Frame-Options: DENY`).
- [ ] Preview deployments do not use the staging or production secrets.

### Inngest

- [ ] Vercel integration installed; staging uses its own Inngest environment.
- [ ] App synced; all 12 functions are listed:
  - `import-parse`, `import-validate`, `import-commit`;
  - `lifecycle-nightly`, `lifecycle-recompute`;
  - `stats-nightly`, `vocatives-refresh`;
  - `messaging-tick`, `messaging-events`;
  - `health-check`, `daily-digest`, `retention-nightly`.
- [ ] `messaging-tick` runs every minute without errors. `health-check` runs every 15 minutes.
- [ ] Signed requests only (`INNGEST_SIGNING_KEY` set; unsigned calls to `/api/inngest` are
      refused).

### SMTP / e-mail provider

- [ ] EU provider with SMTP, listed as a sub-processor.
- [ ] Sending domain verified with SPF, DKIM and DMARC; `EMAIL_FROM` uses it.
- [ ] Two places use it: the Supabase Auth SMTP settings (password reset) and `SMTP_URL`
      (invitations, approval requests, operator digest).
- [ ] An invitation and an approval-request e-mail arrive and their links point to the staging
      domain.

### BulkGate

- [ ] Separate application for staging (its own `application_id` and token); production gets
      another.
- [ ] Alphanumeric sender ID requested and approved. At most 11 characters, letters and
      digits; the app sends `gText` with the shop's `default_sender_name`.
- [ ] Delivery report URL set with the secret query parameter. "Bulk DLR" may be on or off;
      both are supported.
- [ ] **Inbound STOP replies:** check with BulkGate what is needed for replies. Recipients
      usually cannot reply to an alphanumeric sender. The STOP keyword then works only with a
      reply-capable sender (numeric or a dedicated inbound number) whose inbound messages go to
      the same webhook (status 10). The opt-out link works either way.
- [ ] Credit topped up; price per segment known (`SMS_PRICE_PER_SEGMENT_MINOR`).
- [ ] If BulkGate offers an IP allowlist for API calls, consider it. Vercel egress IPs are not
      fixed on standard plans.

### Sentry

- [ ] EU region organisation; environment set by `APP_ENV`.
- [ ] `SENTRY_DSN` (server) and `NEXT_PUBLIC_SENTRY_DSN` (browser) set; production refuses to
      start without `SENTRY_DSN`.
- [ ] Alert rule: e-mail on new issues.
- [ ] Optional: source-map upload (needs `withSentryConfig` and an auth token; not configured
      yet).
- [ ] Spot-check the first event: no phone numbers, e-mails, cookies or headers (scrubbing is
      on).

### Backup storage and encryption key

- [ ] EU bucket in another provider's account, 30-day lifecycle rule, token limited to that
      bucket.
- [ ] age key pair generated offline. The public key goes into `BACKUP_AGE_RECIPIENT`; the
      private key is stored offline (two copies, owner only).
- [ ] Read-only database role for the dump; `BACKUP_DATABASE_URL` uses the direct connection,
      not the pooler.
- [ ] `Nightly backup` run by hand succeeds; the file appears in the bucket.
- [ ] Restore drill into a fresh project passes; recorded in
      `docs/runbooks/restore-drill-log.md`.

### Opt-out domain

- [ ] Short domain attached to the same Vercel project (it only needs `/o/*`).
- [ ] `OPT_OUT_BASE_URL` is the opt-out host plus `/o`, without a scheme: production `<short>.cz/o`;
      staging its own host, e.g. `staging.<brand>.cz/o` (one hostname can serve only one
      deployment). Never change the production value later: links in SMS already sent must keep
      working.
- [ ] Opening `https://<short>.cz/o/<token>` on a phone shows the shop name and the button.
      Unknown tokens give 404.
- [ ] The SMS shows the link as a tappable link on Android and iOS (test with your phone).

### Uptime monitoring

- [ ] `GET /api/health` every minute; alert on non-200 for 2 consecutive checks.
- [ ] The opt-out domain checked separately (e.g. `/o/AAAAAAAA` expecting 404 from the app, not
      a DNS or TLS error).
- [ ] Alerts go to the operator's e-mail or phone.

### GitHub CI

- [ ] Private repository, Actions enabled; CI green on `main`:
  - typecheck, lint, format, unit with coverage;
  - PGlite database tests and the build;
  - demo end-to-end;
  - Supabase from scratch, database tests, the RLS check and Supabase end-to-end;
  - the restore drill.
- [ ] Branch protection: CI required before merging.
- [ ] Environment `production` (and `staging` if you back it up too) holds the `BACKUP_*`
      secrets. CI itself needs no secrets: it uses well-known local Supabase keys.
- [ ] Known intermittent test: see `docs/import-flake.md`.

## 3. Environment variables (staging and production)

Set in Vercel per environment. Variables marked **required** stop the app from starting when
missing or invalid. Values are placeholders; never commit real ones.

| Service  | Variable                        | Staging                                | Production                       | Notes                                                                      |
| -------- | ------------------------------- | -------------------------------------- | -------------------------------- | -------------------------------------------------------------------------- |
| App      | `APP_ENV`                       | `staging`                              | `production`                     | Selects the safety rules.                                                  |
| App      | `DATA_SOURCE`                   | `supabase`                             | `supabase`                       | **Required** in production.                                                |
| App      | `NEXT_PUBLIC_APP_URL`           | `https://staging.<brand>.cz`           | `https://app.<brand>.cz`         | **Required**: https, not localhost or example.                             |
| App      | `OPT_OUT_BASE_URL`              | `staging.<brand>.cz/o`                 | `<short>.cz/o`                   | **Required**: real domain, no scheme.                                      |
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`      | project URL                            | project URL                      | **Required**.                                                              |
| Supabase | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key                               | anon key                         | **Required**.                                                              |
| Supabase | `SUPABASE_SERVICE_ROLE_KEY`     | service key                            | service key                      | **Required**; server only.                                                 |
| Security | `SUPPRESSION_PEPPER`            | 32+ random bytes, base64               | different value                  | **Required**; never rotate without re-hashing.                             |
| Inngest  | `JOB_RUNNER`                    | `inngest`                              | `inngest`                        | **Required** in production.                                                |
| Inngest  | `INNGEST_EVENT_KEY`             | set by the integration                 | set by the integration           | **Required** in production.                                                |
| Inngest  | `INNGEST_SIGNING_KEY`           | set by the integration                 | set by the integration           | **Required** in production.                                                |
| BulkGate | `SMS_PROVIDER`                  | `bulkgate`                             | `bulkgate`                       | Production refuses `mock`.                                                 |
| BulkGate | `SMS_PROVIDER_API_KEY`          | staging `application_id`               | production `application_id`      | **Required** with BulkGate.                                                |
| BulkGate | `SMS_PROVIDER_API_SECRET`       | staging token                          | production token                 | **Required** with BulkGate.                                                |
| BulkGate | `SMS_WEBHOOK_SECRET`            | 32+ characters                         | different value                  | **Required**; also in the DLR URL.                                         |
| BulkGate | `SMS_TEST_WHITELIST`            | `+420…` (your phones, comma-separated) | empty                            | **Required** outside production with a real gateway.                       |
| BulkGate | `SMS_RATE_PER_SECOND`           | `5`                                    | `10` (or the contract rate)      | Dispatcher rate.                                                           |
| BulkGate | `SMS_PRICE_PER_SEGMENT_MINOR`   | the contract price                     | the contract price               | CZK haléře per segment, for cost figures.                                  |
| E-mail   | `EMAIL_PROVIDER`                | `smtp`                                 | `smtp`                           | Production refuses `mock`.                                                 |
| E-mail   | `SMTP_URL`                      | `smtps://user:pass@smtp.provider:465`  | same form                        | **Required** with smtp; URL-encode the password.                           |
| E-mail   | `EMAIL_FROM`                    | `Návrat <no-reply@<brand>.cz>`         | same                             | **Required**: not example.*.                                               |
| AI       | `AI_PROVIDER`                   | `mock` (or the provider)               | `mock` or `openai` / `anthropic` | Optional; the mock uses library templates.                                 |
| AI       | `AI_MODEL`, `AI_API_KEY`        | —                                      | if a real provider is used       | **Required** with a real provider (EU or zero-retention, a sub-processor). |
| Sentry   | `SENTRY_DSN`                    | DSN                                    | DSN                              | **Required** in production.                                                |
| Sentry   | `NEXT_PUBLIC_SENTRY_DSN`        | DSN                                    | DSN                              | Browser errors.                                                            |

**Not set in staging or production:** `DEMO_MODE` (derived), `DEV_ALLOW_REAL_LOOKING_DATA`
(refused in production), `SEED_USER_PASSWORD` (local seed only; the seed refuses non-local
URLs). The spec's `SUPABASE_DB_URL`, `EMAIL_PROVIDER_API_KEY` and `UPSTASH_REDIS_*` are not used
(ADR-018): rate limits live in Postgres, e-mail goes through `SMTP_URL`, and backups use
`BACKUP_DATABASE_URL`.

**GitHub environment secrets** for backups (`.github/workflows/backup.yml`):
`BACKUP_DATABASE_URL`, `BACKUP_AGE_RECIPIENT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`,
`BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`.

**Outside the app**, in the dashboards: the Supabase Auth SMTP settings (host, port, user,
password, sender), the BulkGate delivery report URL, and the uptime monitor URLs.

## 4. Supabase auth settings to recreate in the hosted project

The local `supabase/config.toml` configures only the local stack. Apply these to staging and
production with `supabase config push` (linked project) or by hand in the dashboard, then
check every line:

| Setting (dashboard)                                               | Value                                                                           | `config.toml`                                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Authentication → Sign In / Providers → Allow new users to sign up | **off** (invite-only)                                                           | `[auth] enable_signup = false`                                                      |
| Email provider                                                    | enabled (needed for invites and password reset)                                 | `[auth.email] enable_signup = true` (the global switch above still blocks sign-ups) |
| Confirm email                                                     | off (users are invited)                                                         | `enable_confirmations = false`                                                      |
| Secure email change (confirm both addresses)                      | on                                                                              | `double_confirm_changes = true`                                                     |
| Secure password change (recent sign-in required)                  | on                                                                              | `secure_password_change = true`                                                     |
| Anonymous sign-ins                                                | off                                                                             | `enable_anonymous_sign_ins = false`                                                 |
| Manual linking                                                    | off                                                                             | `enable_manual_linking = false`                                                     |
| Phone / SMS sign-in                                               | off                                                                             | `[auth.sms] enable_signup = false`                                                  |
| Minimum password length                                           | **12**                                                                          | `minimum_password_length = 12`                                                      |
| Password requirements                                             | letters and digits                                                              | `password_requirements = "letters_digits"`                                          |
| Leaked-password protection (HaveIBeenPwned)                       | **on** (hosted only, Pro)                                                       | not available locally                                                               |
| Multi-Factor → TOTP                                               | **enabled** (enrol and verify)                                                  | `[auth.mfa.totp] enroll_enabled = verify_enabled = true`                            |
| Multi-Factor → Phone                                              | disabled                                                                        | `[auth.mfa.phone]` false                                                            |
| Maximum MFA factors                                               | 10                                                                              | `max_enrolled_factors = 10`                                                         |
| JWT expiry                                                        | 3600 s                                                                          | `jwt_expiry = 3600`                                                                 |
| Refresh token rotation and reuse interval                         | on, 10 s                                                                        | `enable_refresh_token_rotation`, `refresh_token_reuse_interval`                     |
| URL configuration → Site URL                                      | `https://<staging or app domain>`                                               | `site_url` (localhost locally)                                                      |
| URL configuration → Redirect URLs                                 | `https://<domain>/**`                                                           | `additional_redirect_urls` (localhost locally)                                      |
| Email template "Reset password"                                   | subject "Obnovení hesla – Návrat", body from `supabase/templates/recovery.html` | `[auth.email.template.recovery]`                                                    |
| SMTP settings                                                     | the provider's host, port, user, password; sender = `EMAIL_FROM`                | Mailpit locally                                                                     |
| Rate limits → e-mails per hour                                    | at least 30 with custom SMTP                                                    | local `email_sent = 2`                                                              |
| Rate limits → sign-ins / verifications                            | defaults (30 / 5 min) or stricter                                               | `sign_in_sign_ups`, `token_verifications`                                           |
| API → Max rows                                                    | 1000 (default)                                                                  | `[api] max_rows = 1000`                                                             |
| API → Exposed schemas                                             | `public`, `graphql_public` only                                                 | `[api] schemas`                                                                     |

The app's own controls do not depend on these settings, but they add to them:

- the database requires `aal2` for operators;
- failed sign-ins are rate-limited per e-mail and IP;
- invitations use the app's own tokens.

Signing up must still be off, otherwise anyone could create an account (with no shop access).
