# ADR-016: Hardening (Phase 1, slice 16)

- Status: accepted
- Date: 2026-11-05
- Context: spec §10 (support view), §21 (retention), §22 (security architecture, rate limits),
  §25 (observability), §30 (backups, restore drill, runbooks), §41, §40.16

## Decisions

1. **Security headers** (`next.config.ts`, every route):
   - **CSP:**
     - sources: `self`, plus the Supabase origin (browser uploads use signed URLs) and the
       Sentry origin when configured;
     - `'unsafe-inline'` for Next.js bootstrap scripts and styles, and `'unsafe-eval'` only in
       development;
     - `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`.
   - **Other headers:** HSTS (2 years, preload); `X-Frame-Options: DENY`; `nosniff`;
     `strict-origin-when-cross-origin` (the opt-out page uses `no-referrer`, because its token
     is in the URL); a minimal Permissions-Policy; COOP `same-origin`; no `X-Powered-By`.
   - A nonce-based CSP can replace `'unsafe-inline'` later.
2. **Rate limits in Postgres** (`public.hit_rate_limit`, fixed windows, service role):
   - No third-party store and no extra secrets. Keys hash the subject (IP, e-mail).
   - The limit fails open on a database error, which is logged.

   | Scope                                                | Limit                                                            |
   | ---------------------------------------------------- | ---------------------------------------------------------------- |
   | Failed sign-ins (checked before, counted on failure) | 10 / 15 min per e-mail and per IP                                |
   | Password reset                                       | 5 / h; over the limit nothing is sent, the answer stays the same |
   | Invitation acceptance                                | 10 / 15 min per IP                                               |
   | AI generation and rewrite (spec: 30 / h / user)      | 30 / h / user                                                    |
   | Opt-out POST                                         | 20 / 10 min per IP                                               |
   | Gateway webhooks                                     | 600 / min per provider (HTTP 429 with `Retry-After`)             |

   On the local stack every request comes from one machine, so per-IP limits apply only in
   staging and production. Old windows are deleted by retention.

3. **Sentry**, only when a DSN is set (`instrumentation.ts`, `instrumentation-client.ts`, Sentry
   SDK 11):
   - `dataCollection` turns off user info, cookies, headers, bodies, query strings and AI
     content;
   - no tracing and no replay;
   - every event and breadcrumb passes `scrubDeep`, which replaces phone numbers and e-mails
     and drops contact fields by name.

   Production refuses to start without `SENTRY_DSN`. Source-map upload (`withSentryConfig`
   plus an auth token) is part of the production setup.

4. **`/api/health`**: a public database ping. It answers with status words only
   (`{status, db, dbMs}`), `Cache-Control: no-store`, and 503 when the database does not
   answer.
5. **Retention** (nightly, 04:00 Prague; `pnpm jobs:retention` locally):
   - import files in Storage after 30 days (the job, via the Storage API);
   - then `public.run_retention(now)` in one transaction:
     - staging rows after 90 days;
     - message bodies after 24 months (replaced by `[redacted]`; metadata kept);
     - customers with no visit in 5 years and no contact in 2: flagged, then deleted 30 days
       later unless the flag is cleared;
     - audit logs after 24 months;
     - shops closed more than 30 days ago (`companies.closed_at`, set by trigger).
   - The audit log stays append-only. Its guard allows only that retention delete, marked by
     a transaction-local setting and limited to rows older than 24 months.
   - The run writes `system.retention_run` with its counts.
6. **Backups.**
   - `.github/workflows/backup.yml` runs nightly: `pg_dump -Fc` piped to `age`, uploaded to
     EU object storage in another provider's account (30-day lifecycle).
   - It skips itself until the production secrets exist.
   - `pnpm db:restore-drill` performs the drill on the local stack:
     1. dump;
     2. restore into a fresh database;
     3. compare row counts per public table and check that RLS is enabled and forced
        everywhere;
     4. drop the copy;
     5. append the result to `docs/runbooks/restore-drill-log.md`.

     First local drill: PASS, 27 tables and 36 728 rows.
7. **Support view on real data.**
   - "Otevřít účet klienta" asks for a reason (and an optional note) and writes
     `admin.support_view_started`.
   - An httpOnly cookie (2 h) names the company; every request still needs a platform admin
     with MFA.
   - The client UI shows the banner. It is read-only: no contact edits, conversion buttons,
     pause or approval. "Ukončit" writes `admin.support_view_ended`.
   - The second "allow writes" toggle from spec §10 is not built. The operator writes from the
     admin screens instead.
8. **Proof that a dispatcher crash causes no duplicates.**
   `tests/e2e-supabase/dispatcher-crash.spec.ts` runs the real tick:
   1. a dispatcher dies after claiming a batch;
   2. the next one crashes inside a provider call;
   3. later runs finish the queue.

   Every idempotency key reaches the gateway at most once. The orphans and the crashed call
   end in manual review.

9. **Runbooks** (`docs/runbooks/`): provider outage, duplicate send, data leak, failed
   migration, restore from dump, deploy and secret rotation. The DoD status is in
   `docs/definition-of-done.md`.

## Not done here (needs the owner)

- Production deploy (Supabase EU project, Vercel `fra1`, Inngest, BulkGate, Sentry, the backup
  bucket and keys): see `docs/runbooks/deploy.md`.
- A real SMS test on the staging whitelist.
- The first production restore drill.
- The signed DPA template, the sub-processor list and the legal review.
