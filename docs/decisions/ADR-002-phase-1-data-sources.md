# ADR-002: Phase 1 keeps the demo as a data source next to Supabase

- Status: accepted
- Date: 2026-10-05
- Context: spec §26 (stack), §29 (Phase 1), §32 (environments), §39 (env), ADR-001

## Context

Phase 1 turns the Phase 0 prototype into the internal managed-service MVP on
Supabase (Postgres EU, Auth, Storage), Inngest and a real SMS adapter. The
Phase 0 demo flow is still the founder's sales tool and must keep working
without a database.

## Decision

1. `DATA_SOURCE` selects the data layer: `demo` (in-memory deterministic seed,
   always labelled `DEMO_MODE=true`) or `supabase` (real MVP, never labelled as
   demo). Production must use `supabase`; enforced in `lib/env/schema.ts`.
2. Pages keep calling the functions in `lib/db/queries.ts` / `mutations.ts`;
   later slices add a Supabase implementation behind the same signatures and
   pick it by `DATA_SOURCE`.
3. Local development uses the Supabase CLI (`supabase` dev dependency,
   `supabase/config.toml`) exactly as the spec describes. `supabase start`
   needs Docker Desktop; the CLI and config live inside the repository.
4. Environment rules are a pure, unit-tested `parseEnv`; `lib/env.ts` applies
   it at server start and is `server-only`.
5. E2E runs locally on the installed Microsoft Edge (Playwright `msedge`
   channel) and on Playwright Chromium in CI.

## Consequences

- Slices that need the database (schema + RLS tests, auth, imports, jobs)
  require Docker Desktop on the development machine, or CI.
- The demo seed must stay compatible with the shared row types until the
  demo is re-implemented as a seeded Supabase project (spec §31 `pnpm db:seed`).

## Addendum (slice 2): database tests without Docker

Docker Desktop on the development machine reports "no virtualization
available", so `supabase start` cannot run until hardware virtualization is
enabled. `pnpm db:test:local` (scripts/db/pglite-test.ts) applies all
migrations to PGlite on top of `scripts/db/supabase-stub.sql` (API roles,
`auth.users`, `auth.uid()`, Supabase's default grants) and runs
`supabase/tests/database/*.test.sql` through `scripts/db/pgtap-shim.sql`.
It runs in `pnpm check` and in CI next to the authoritative
`supabase test db` job. A mutation check (opening one policy, un-forcing RLS
on one table) turned the suite red as expected.
