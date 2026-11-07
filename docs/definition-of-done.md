# Definition of Done (spec §41): status after Phase 1 and ADR-018

Evidence is a test that runs in CI or locally (`pnpm check`, `pnpm db:test`,
`pnpm test:e2e`, `pnpm test:e2e:supabase`), unless marked otherwise. **Open** items need the
owner: accounts, production credentials, legal work.

## Functional

| Requirement                                                                                                     | Status         | Evidence                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create 3 shops                                                                                                  | ✅             | `companies.spec.ts`; seeded world (`pnpm db:seed`)                                                                                                                                                                |
| Import a messy Windows-1250 CSV and an XLSX, correct counts                                                     | ✅             | `imports.spec.ts`, fixtures `pnpm db:fixtures`, `06_imports.test.sql`                                                                                                                                             |
| Invalid, warning and duplicate rows shown with reasons; re-import creates no duplicates                         | ✅             | `imports.spec.ts`, `tests/unit/imports.test.ts`                                                                                                                                                                   |
| Lifecycle statuses and all presets match fixture tests                                                          | ✅             | `07_lifecycle.test.sql`, `08_segments.test.sql` (exact counts per preset)                                                                                                                                         |
| Campaign from a preset: AI template, edit, segment count and cost, 5 recipient previews, 2 follow-ups, schedule | ✅             | `campaigns.spec.ts`, `ai.spec.ts`, `messaging.spec.ts`                                                                                                                                                            |
| Approval flow in both modes                                                                                     | ✅             | `campaigns.spec.ts`, `09_campaigns.test.sql`                                                                                                                                                                      |
| Real SMS campaign to the staging whitelist with delivery reports; follow-ups stop after opt-out                 | **Open**       | Code ready (BulkGate adapter, webhook, stop conditions; `bulkgate.test.ts`, `messaging.spec.ts` with the mock). Needs the owner's BulkGate account and a staging deploy.                                          |
| Opt-out link works on mobile in one tap, is idempotent, survives customer deletion                              | ✅ / by design | `messaging.spec.ts` (one tap, idempotent, 404 for unknown tokens). After deletion the link still resolves through the message row (`customer_id` is set to null, number and company stay); not separately tested. |
| Holdout receives nothing and appears in the holdout comparison                                                  | ✅             | `messaging.spec.ts`, `11_messaging.test.sql`, `13_conversions.test.sql`, `conversions.spec.ts`                                                                                                                    |
| Marking booked or completed updates the client dashboard within 1 minute                                        | ✅ (immediate) | `13_conversions.test.sql` (trigger recompute), `dashboards.spec.ts`                                                                                                                                               |
| Client dashboard: revenue, 5 KPIs, chart, campaigns, returns, opportunities, 390 px                             | ✅             | `dashboards.spec.ts` (390 px, no horizontal scroll)                                                                                                                                                               |
| Attention Required: 6 rules and "Vše běží normálně"                                                             | ✅             | `dashboards.test.ts`, `domain.test.ts`, `dashboards.spec.ts`, `14_dashboards.test.sql`                                                                                                                            |

## Safety and quality

| Requirement                                                                       | Status   | Evidence                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RLS tests for every table; no cross-shop access via UI, actions or direct queries | ✅       | `01_tenant_isolation.test.sql` (harness covers every `company_id` table; CI fails on a table without enabled + forced RLS), `auth.spec.ts`, `customers.spec.ts`                                                                                                                                                                              |
| A dispatcher killed mid-send causes zero duplicates                               | ✅       | `dispatcher-crash.spec.ts`, `11_messaging.test.sql`                                                                                                                                                                                                                                                                                          |
| Never outside the sending window or on Czech holidays                             | ✅       | `messaging.test.ts` (window, Easter, fixed holidays), `dispatch.test.ts`; the dispatcher and starts check the window                                                                                                                                                                                                                         |
| Non-production reaches the real gateway only for whitelisted numbers              | ✅       | `env.test.ts` (boot check), `dispatch.test.ts` (`addressAllowed`), dispatcher cancels with `not_whitelisted`                                                                                                                                                                                                                                 |
| Audit entries for spec §23 actions; audit rows cannot be updated or deleted       | ✅       | Append-only guard in `02_permissions_integrity.test.sql` and `15_hardening.test.sql`. Entries are asserted for campaigns, conversions, imports, support view, kill switch, opt-out, users, data subject requests, exports, erasures and company views (`settings-privacy.spec.ts`); two §23 actions are not applicable in Phase 1 (ADR-018). |
| Support view read-only, with banner and logged reason                             | ✅       | `hardening.spec.ts`                                                                                                                                                                                                                                                                                                                          |
| No phones or e-mails in Sentry, logs or AI requests                               | ✅       | `hardening.test.ts` (scrubber), Sentry `dataCollection` off, logs print IDs and codes only, `ai.test.ts` (masking)                                                                                                                                                                                                                           |
| Nightly independent backup and one restore drill                                  | Partly   | `backup.yml` ready (needs secrets); local drill PASS in `runbooks/restore-drill-log.md`. **Open:** production backup and the first production drill.                                                                                                                                                                                         |
| Typecheck, lint, unit, DB, integration and E2E green in CI                        | ✅       | `.github/workflows/ci.yml` runs all of them; green on GitHub since the repository was pushed.                                                                                                                                                                                                                                                |
| Signed DPA template, sub-processor list, legal review                             | **Open** | Owner and lawyer.                                                                                                                                                                                                                                                                                                                            |

## Phase 1 review (ADR-017)

The review before the first pilot found and fixed these. Each has a regression test.

| Finding                                                                                            | Status   | Evidence                                                                    |
| -------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------- |
| Operator MFA was enforced only in the app; a password-only session read every shop through the API | ✅ fixed | `16_review_fixes.test.sql`, `review-fixes.spec.ts`                          |
| Campaign snapshots stopped at 1,000 recipients (API row limit)                                     | ✅ fixed | `review-fixes.test.ts`, `review-fixes.spec.ts` (real 1,000+ audience)       |
| Production could start with example/localhost addresses in SMS and e-mail links                    | ✅ fixed | `env.test.ts`                                                               |
| Shop owners could change operator-controlled company columns (sender name, price, …)               | ✅ fixed | `16_review_fixes.test.sql`                                                  |
| No explicit function time limit; up to 500 sequential sends per tick                               | ✅ fixed | `review-fixes.spec.ts` (time budget), `dispatcher-crash.spec.ts`            |
| Inbound replies and numbers kept forever in gateway events; numbers never redacted                 | ✅ fixed | `16_review_fixes.test.sql`, `messaging.spec.ts`, `review-fixes.test.ts`     |
| Support view read-only only in the UI                                                              | ✅ fixed | `hardening.spec.ts`, `review-fixes.test.ts`                                 |
| Demo actions callable on real data                                                                 | ✅ fixed | `action-guards.test.ts`                                                     |
| SMS gateway circuit breaker (spec §24) missing                                                     | ✅ built | `review-fixes.spec.ts` (trip, alert, pause, probe, recovery, no duplicates) |

The review also found gaps against the spec. ADR-018 closed every one that needs no external
service:

| Gap                                                                                      | Status           | Evidence                                                                                        |
| ---------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------- |
| Data subject requests: export, erasure, the `data_subject_requests` log, alert at day 20 | ✅ built         | `17_settings_dsr.test.sql`, `privacy.test.ts`, `settings-privacy.spec.ts`, `dashboards.test.ts` |
| Client "Nastavení" (profile, users, data and privacy, DPA download, history)             | ✅ built         | `settings-privacy.spec.ts` (owner, manager, 390 px)                                             |
| User role change and removal; last owner kept; no membership bypass                      | ✅ built         | `users.test.ts`, `17_settings_dsr.test.sql`, `settings-privacy.spec.ts`                         |
| Audit log viewer (company tab, system log, owner history; filter by event and date)      | ✅ built         | `audit-filters.test.ts`, `settings-privacy.spec.ts`                                             |
| Operator's all-campaigns list                                                            | ✅ built         | `settings-privacy.spec.ts`, `real-data-routes.test.ts`                                          |
| Retention flag for imported customers and the shop's objection                           | ✅ fixed         | `17_settings_dsr.test.sql`, `settings-privacy.spec.ts`                                          |
| Login lockout after 5 failures (was 10)                                                  | ✅ fixed         | `hardening.test.ts`, `hardening.spec.ts`                                                        |
| Alert for imports stuck in processing                                                    | ✅ built         | `dashboards.test.ts`, `settings-privacy.spec.ts`                                                |
| §23 audit actions                                                                        | ✅ / 2 by design | See below                                                                                       |

**§23 audit actions:** every action in the spec is written, with these exceptions:

- `admin.write_mode_enabled`: support view stays read-only; there is no write mode to log.
- `conversion.confirmed_bulk`: bulk confirmation belongs to visit re-import matching (Phase 2).

Names now follow §23 (`campaign.send_started`, `campaign.send_completed`,
`conversion.marked`, `conversion.revenue_changed`). `conversion.reverted`,
`customer.retention_kept`, `user.invitation_revoked` and the auth events are extras.

**Still open:** the client "Oznámení" tab (Phase 2, with the monthly results e-mail), and a PDF
summary of the access export (the JSON export is complete; ADR-018).
