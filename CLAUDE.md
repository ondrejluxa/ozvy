@AGENTS.md

# Návrat — rules for coding agents

Read `docs/spec.md` (authoritative: `docs/spec.pdf`) before changing behaviour.
Phase 0 (spec §29, sales demo on deterministic fake data) is done; Phase 1 is being built
slice by slice in the order of spec §40, stopping after each slice for review. See
`docs/decisions/ADR-001-*.md` and `ADR-002-*.md`. The demo must keep working as `DATA_SOURCE=demo`.

## Non-negotiables (also in Phase 0)

- Fake data only. No real customer data anywhere; emails on example.cz / example.com.
- Every demo figure stays labelled: the demo bar, `DemoTag`, `CompanyName`. `DEMO_MODE`
  cannot be turned off while `DATA_SOURCE=demo` (enforced in `lib/env/schema.ts`).
- Mock SMS and AI providers stay the default outside production; real adapters arrive in
  their slices (spec §40.11–13) and are gated by `lib/env/schema.ts`.
- Business logic lives in `lib/domain` as pure TypeScript with unit tests. Server
  actions are thin: Zod → domain/db call → typed `ActionResult`.
- Every query/mutation takes `companyId` explicitly and goes through the company index.
- Money is integer haléře (`*_minor`), formatted only via `lib/domain/money.ts`.
  Dates display as "25. 9. 2026" via `lib/domain/dates.ts` (Europe/Prague).
- All UI strings go in `messages/cs.json`; code, identifiers and comments in English.
- Every message template must contain `{{odhlaseni}}`; holdout customers never
  receive messages and never count as recovered revenue.
- One fake world for demo and Supabase: `lib/db/demo/seed.ts`, loaded into the local stack by
  `pnpm db:seed` (`supabase/seed/rows.ts`, ADR-004). Import fixtures: `pnpm db:fixtures`.
- `tests/unit/seed.test.ts` guards the presentation numbers. Run `pnpm check` after changes.

## Scope

Build only Phase 1 (spec §29, prompt in spec §42). Do not build Phase 2+ features (billing,
automations, email campaigns, two-way SMS, integrations, visit re-import matching).
Real SMS sends only to SMS_TEST_WHITELIST outside production. Run `pnpm check` and
`pnpm test:e2e` after each slice.
