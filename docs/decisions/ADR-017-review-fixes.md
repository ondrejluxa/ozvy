# ADR-017: Phase 1 review fixes before the first pilot

- Status: accepted
- Date: 2026-11-05
- Context: the Phase 1 review (spec compliance, security and privacy, production readiness).
  Every item below was found by the review, confirmed against the code, and has a regression
  test.

## Fixes

1. **Admin MFA in the database** (was: a password-only operator session read every shop through
   the public API).
   - `app.is_platform_admin()` now also requires `auth.jwt() ->> 'aal' = 'aal2'`, i.e. a
     completed TOTP step. Every operator policy (all tables, storage) inherits it.
   - The operator's own `platform_admins` row stays readable at aal1, so the app can still send
     the operator to the MFA step.
   - Tests: `16_review_fixes.test.sql`; `review-fixes.spec.ts` makes a real aal1 API session
     (0 customers, no kill switch). All pgTAP sessions now carry `aal`.
2. **Recipient lists over 1,000** (was: the campaign snapshot read the audience with one
   request, and the API returns at most `max_rows` = 1,000 rows. With 1,174 eligible, 174
   customers were silently skipped, under the 20 % drift pause).
   - `lib/db/paginate.ts` `fetchAllPages` reads page by page (stable order) and fails loudly on
     errors or runaway sizes.
   - Campaign results now aggregate in SQL (`campaign_summaries`), not by summing rows.
   - Tests: unit; `review-fixes.spec.ts` snapshots a real 1,000+ audience.
3. **Production addresses** (was: production could start with `OPT_OUT_BASE_URL=example.cz/o`
   and `NEXT_PUBLIC_APP_URL=http://localhost:3000`, i.e. dead links in every SMS and e-mail).
   Outside `APP_ENV=local`:
   - `NEXT_PUBLIC_APP_URL` must be `https://` and not localhost or example.*;
   - `OPT_OUT_BASE_URL` must be a real domain without a scheme;
   - `EMAIL_FROM` must not be example.*.

   Tests: `env.test.ts`.

4. **Owners edit their profile only** (was: a deny-list let owners change the SMS sender name,
   subscription price, job value, closing date and other new columns through the API).
   - `app.guard_company_update` is now an allow-list. End users may change only `name`, `ico`,
     `dic`, address, contact fields, `website`, `logo_path` and `opening_hours`. Every other
     column, including future ones, is operator-only.
   - Tests: `16_review_fixes.test.sql`.
5. **Hosting time limits.**
   - The Inngest route declares `maxDuration = 300` s.
   - The dispatcher claims 10 messages at a time and stops sending after a 40 s budget, at most
     rate × 40 per tick.
   - The BulkGate timeout is 10 s, so the worst batch is 100 s.
   - A cut-off invocation leaves at most one small batch in `sending`, which goes to manual
     review, never to a duplicate.
   - Tests: `review-fixes.spec.ts` (budget reached, nothing half-sent),
     `dispatcher-crash.spec.ts`.
6. **Gateway events and old numbers** (was: inbound replies with the sender's number and text
   kept forever; `to_address` never redacted).
   - Processing an event strips everything except delivery metadata (`stripEventPayload`).
   - Retention deletes raw events after 90 days and redacts `to_address` together with the body
     after 24 months. An opt-out link to a redacted message resolves to 404; STOP replies still
     work.
   - Tests: unit, `16_review_fixes.test.sql`, `messaging.spec.ts`.
7. **Support view read-only at the server** (was: only buttons were hidden).
   - `requireContext` refuses every write while an operator's support view is open
     (`support_view_read_only`). Pages and downloads pass `read: true`; only starting and
     ending the support view are exempt.
   - The admin screens show a banner while it is open.
   - Tests: unit (`supportViewBlocks`), `hardening.spec.ts` (a real kill-switch attempt is
     refused).
8. **Demo actions guarded** (was: six Phase 0 actions callable without a check on real data).
   - Each refuses unless `DATA_SOURCE=demo`, then goes through `requireContext`.
   - A unit test scans every `"use server"` file: each exported action calls `requireContext`,
     a demo guard, or is on a documented public list.
9. **SMS gateway circuit breaker** (spec §24; deferred in ADR-012 and missed in slice 16).
   - Gateway failures are retryable rejections (5xx, 429) and unknown outcomes. Rejected numbers
     do not count.
   - Failures are counted per provider and minute (`provider_attempts`,
     `record_provider_attempts`).
   - **Trip:** more than 20 % failures over the last 5 minutes, with at least 20 attempts.
     Sending and campaign starts then pause for 15 minutes, and a critical "provider_paused"
     alert opens at once.
   - **Recovery:** after the pause, exactly one probe message is sent. Success closes the
     breaker and resolves the alert; failure pauses again (`probe_failed`).
   - **Manual reset:** the operator can end the pause early on `/admin/system` ("Zkusit bránu
     znovu", audited), which triggers the probe.
   - **No duplicates:** messages rejected by the gateway were not sent, so they return to the
     queue with backoff; unknown outcomes go to manual review.
   - Tests: unit; `review-fixes.spec.ts` (trip, alert, pause, health check keeps the alert,
     probe success, probe failure, no message accepted twice).

## Not changed (documented for later)

- The `app` schema's default EXECUTE grants: not reachable (only `public` is exposed). Revoke
  them when the schema is exposed.
- Per-IP limits trust the first `X-Forwarded-For` hop: correct behind Vercel, which sets the
  header. Revisit if another proxy is added.
- Owners may add memberships for an existing user UUID through RLS (invitation bypass, only
  their own shop). Tighten with the user management screens.
- The opt-out page GET is not rate-limited; tokens have about 48 bits of entropy.
