# Intermittent import end-to-end failure (investigation, 2026-11-07)

## Symptom

`tests/e2e-supabase/imports.spec.ts` failed in 2 of 4 full Supabase runs before the review-fix
commit: once the CSV test, once the XLSX test. Each time, the page stayed on "Kontroluji data ·
Zpracovávám…" for the full 60 s after "Zkontrolovat data". The test passed on its own and in
smaller subsets.

## What was added (diagnostics only, no behaviour change)

- `lib/jobs/runner.ts`: each inline job logs one JSON line per phase:
  - `queued`;
  - `started` with `waitMs`;
  - `done` or `failed` with `ms`.

  The lines carry the event name and IDs only, never personal data.

- `playwright.supabase.config.ts`: `E2E_SERVER_LOG=1` pipes the dev server's output into the
  test log. By default it is ignored, as before.
- `imports.spec.ts`: when the "Kontrola dat" step times out, the test prints the import's
  database row (`status`, `counts`, `updated_at`) before failing. The timeouts are unchanged.

## Result

Two consecutive full runs with diagnostics: **86 of 86 tests passed** (43 + 43). There were
36 inline jobs:

- every one went `queued` → `started` → `done`;
- none failed or was lost;
- the longest wait before start was 0.42 s;
- the longest run was 0.46 s.

The validate job itself takes about 0.15 s on the 431-row fixture. The page polls every
1.5 s (`AutoRefresh`).

## Assessment

The stall did not reproduce, so no single cause is proven. Each hypothesis checked against the
evidence:

| Hypothesis                                                                                                                                              | Evidence                                                                                                                                                                            | Verdict         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Slow job under database contention                                                                                                                      | Validate takes about 0.15 s; the test allows 60 s                                                                                                                                   | Unlikely        |
| UI polling race                                                                                                                                         | `AutoRefresh` refreshes every 1.5 s; the stuck page showed the server-rendered `validating` state, so the server really saw `validating`                                            | Unlikely        |
| Inline `after()` job lost, or threw before its `try` (`loadImport`/`setImport` on a transient local Supabase error), leaving the import in `validating` | Fits the symptom. The failing runs were not captured with server logs, so this cannot be confirmed. The inline runner has no retry, so one transient error leaves the import stuck. | **Most likely** |

This mechanism is specific to `JOB_RUNNER=inline` (local development and CI only). Staging and
production use Inngest:

- `import-validate` has `retries: 3`;
- a transient error is retried instead of lost;
- Inngest shows every failed run.

## Safe for a real pilot?

**Yes, with two conditions.**

1. Staging and production run `JOB_RUNNER=inngest` (production refuses `inline`). Check on
   staging that an import moves through every step (pilot checklist, "Before you start").
2. Nothing alerts on an import that stays in `parsing`, `validating` or `committing`. The
   operator sees it on the import page. For the pilot, the operator runs the imports and
   watches them. A health-check alert for imports stuck more than 30 minutes would be a small
   Phase 1 hardening item. Not built: it changes behaviour, and the cause is not proven.

## If it happens again

Run `E2E_SERVER_LOG=1 pnpm test:e2e:supabase` and read the `[import-diag]` line and the job
lines for that import ID:

| What the log shows                                               | Meaning                         |
| ---------------------------------------------------------------- | ------------------------------- |
| `queued` but no `started`                                        | The `after()` callback was lost |
| `started` with no `done` or `failed`                             | The job hung                    |
| `failed`                                                         | The error message follows       |
| `done`, but the database row still says `validating`             | A write was lost                |
| `done`, the database row is `ready`, but the page is still stuck | A page refresh problem          |
