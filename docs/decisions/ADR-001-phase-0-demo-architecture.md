# ADR-001: Phase 0 runs on an in-memory demo store, not Supabase

- Status: accepted
- Date: 2026-10-05
- Context: spec §29 (Phase 0), §26 (stack), §37 (project structure)

## Context

Spec §29 lists "Supabase local, schema + RLS for core tables" as part of the
Phase 0 prototype. The development machine has no Docker, and the founder
asked for Phase 0 without Docker or Supabase. The goal of Phase 0 is a
convincing 15-minute sales demo on fake data, not production infrastructure.

## Decision

1. **Data**: one in-memory database per server process (`lib/db/store.ts`),
   seeded deterministically (`lib/db/demo/seed.ts`). Row types in
   `lib/db/types.ts` mirror the Phase 1 SQL schema in spec §18 exactly
   (snake_case, `*_minor` money in haléře, the same enums), so pages and
   domain logic do not change when Supabase replaces the store.
2. **Tenant discipline without RLS**: every query and mutation takes an explicit
   `companyId` and resolves rows only through that company's index
   (`lib/db/company-index.ts`). A mismatched id returns nothing (404).
3. **Seed dates are relative to "now"** so "this month" always shows the
   presentation numbers (218 messages, 14 bookings, 11 jobs, 52 300 Kč,
   4 990 Kč, 10,5×). Each company and seed stage has its own random stream, so
   the customer base is identical on any day. `tests/unit/seed.test.ts` checks
   the numbers on six different dates.
4. **No auth**: the presenter is always the operator. The client view is a
   read-only "support view" selected by a cookie (`lib/auth/context.ts`).
5. **Mocks**: `lib/providers/sms/mock.ts` implements the spec §16 provider
   interface; `lib/ai/client.ts` returns library templates that pass the spec
   §15 validator. Both are the only options allowed by `lib/env.ts`.
6. **Alerts and KPIs** are computed on page load from the same pure functions
   (`lib/domain/alerts`, `lib/domain/attribution`) Phase 1 will run in jobs.
7. **next-intl without its build plugin**: the plugin pulls in a native SWC
   binary that is blocked on this machine; `next.config.ts` sets the
   `next-intl/config` alias directly, which is all the plugin does here.
8. Spec §29 excludes alerts from Phase 0; the founder asked for basic
   Attention Required alerts, so they are included (computed, not stored).

## Consequences

- Demo edits are lost on server restart or "Resetovat demo". Hosting on
  serverless (multiple instances) would show inconsistent state, so the demo
  is meant to run locally (`pnpm dev` or `pnpm build && pnpm start`).
- Phase 1 replaces `lib/db/store.ts`, `company-index.ts`, `queries.ts` and
  `mutations.ts` internals with Supabase + RLS + Inngest jobs; the function
  signatures used by pages stay.
- No SQL migrations exist yet. They are the first Phase 1 slice (spec §40.2).
