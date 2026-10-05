# ADR-003: Authentication and authorization (Phase 1, slice 3)

- Status: accepted
- Date: 2026-10-05
- Context: spec §20 (auth model), §22 (security), §23 (audit), §40.3

## Decisions

1. **Supabase Auth with @supabase/ssr cookies.** `proxy.ts` (Next 16's
   middleware) refreshes the session on every request and does the
   optimistic "signed in?" redirect for `/admin` and `/app`. Authorization
   happens in `requireContext` (layouts, server actions) and in RLS.
2. **One permission map** (`lib/auth/permissions.ts`), exactly the spec §20
   table, unit-tested row by row. `resolveAccess` is pure; `requireContext`
   / `requirePageContext` wrap it with the Supabase session.
3. **Platform admins always need aal2 (TOTP).** Without a verified factor
   they are sent to enrolment; with one, to verification. Unverified factors
   from abandoned enrolments are removed before a new enrolment.
4. **Invitations use our own table and tokens**, not Supabase's invite:
   32 random bytes, SHA-256 hash stored, 7-day expiry, single use enforced by
   an atomic `update … where accepted_at is null`. Accepting creates the user
   with a confirmed email (possession of the link proves it). Lookups by
   token use the service role in a server-only module (not a server action).
   If the email cannot be sent the invitation row is deleted.
5. **Transactional email adapter** (`lib/providers/email`): `smtp` (locally
   the Mailpit inbox of `supabase start`) and `mock`. Production needs a real
   provider (Resend/Postmark, EU) before go-live; `lib/env/schema.ts` refuses
   the mock email provider in production.
6. **Czech recovery email** (`supabase/templates/recovery.html`) links to
   `/auth/confirm` with `token_hash`, so the link works in any browser.
7. **Supabase config:** `[auth] enable_signup = false` disables public
   sign-up. `[auth.email] enable_signup` must stay `true`: it is the email
   provider switch, and turning it off disabled logins entirely (found by the
   E2E suite on real Supabase).
8. **Real data vs demo.** With `DATA_SOURCE=supabase` the proxy rewrites
   screens that still use the in-memory demo store to "Tato část se
   připravuje" (`REAL_DATA_READY` in `proxy.ts`), and `getDb()` refuses to run,
   so demo data can never appear in the real app. Later slices move screens
   over and extend the list.
9. **Audit** (`lib/audit.ts`): `auth.login`, `auth.login_failed`,
   `auth.mfa_enrolled`, `auth.password_reset_requested`,
   `auth.password_changed`, `user.invited`, `user.invitation_accepted`; IDs
   and roles only, never emails.

## Deferred (with reason)

- **Login lockout (5 failures / 15 min per email + IP):** rate limiting is
  slice 16 (spec §40.16, Upstash). Until then Supabase Auth's own per-IP
  limits (`[auth.rate_limit]`) apply.
- **Leaked-password check:** a hosted Supabase Auth setting; enable it on the
  production project.
- **Support view with reason + `admin_access_sessions`:** part of the admin
  slices (spec §40.15); the demo keeps its cookie-based read-only view.
