# ADR-008: Lifecycle job, stored eligibility, service category mapping (Phase 1, slice 8)

- Status: accepted
- Date: 2026-11-03
- Context: spec §11 (service category mapping), §12 (lifecycle, eligibility), §24 (jobs), §40.8

## Decisions

1. **One recompute, in the database.** `public.recompute_lifecycle(company, customers?, today?)`
   computes the last visit, visit count, lifetime value and status per vehicle and
   customer from the visits and the company's thresholds. It runs:
   - after every import commit, for the affected customers;
   - nightly for every open company: an Inngest cron at 03:00 Europe/Prague;
     `pnpm jobs:nightly` runs it by hand locally;
   - after a threshold or lookback change in settings, and from "Přepočítat teď".

   A full run stamps `companies.lifecycle_computed_at`, so dashboards can show
   "Data k …" (spec §24). The nightly job continues past a failing company and logs
   its ID only. The seed calls the same function, so seeded statuses are exactly what
   production would compute.

2. **Stored eligibility.** `customers.eligibility_reason` is set by a
   `BEFORE INSERT/UPDATE` trigger. The value is null when eligible, otherwise the
   first failing rule:
   1. `opted_out`
   2. `no_legal_basis`
   3. `no_mobile`
   4. `too_old` (last visit missing or beyond `max_lookback_months`)

   This is the same order as `lib/domain/contact-rules/audience.ts`.
   - A contact edit, an import or a recompute updates it immediately; the nightly
     recompute handles the time-based "too old" rule.
   - The customer list filter and the detail page both read the stored value, so they
     cannot disagree.
   - "Today" is Europe/Prague and can be overridden per transaction (`app.today`), so
     a recompute with `p_today` and the trigger agree; this is used by the tests.
   - The trigger runs after `customers_guard_update` (triggers fire in name order),
     so shop users still cannot set it by hand.
   - Suppression-list hits join with the opt-out slice (§40.13).

3. **Service category mapping screen** (company tab "Služby"):
   - It lists every distinct work description from the visits, grouped by
     `visits.service_label_norm`. That is a stored generated column using
     `app.normalize_service_label`, which matches `lib/domain/service-labels.ts`; both
     test suites assert the same examples.
   - Each row shows the visit count, the category, and whether it was set by hand
     ("Uloženo") or by the keyword rules ("Automaticky").
   - `public.set_service_category` saves the mapping and re-categorises the existing
     visits in one transaction. It runs as the caller, so RLS lets only the operator do
     it.
   - Audit event: `company.settings_changed` with section `service_categories`, the
     category and the number of visits changed. Work descriptions are shop vocabulary,
     not personal data.
4. **Thresholds** live in the company settings (slice 5); saving a change to the
   lifecycle thresholds or the lookback queues a recompute for that company at once.

## Deferred

- **"Reactivated" status:** it needs completed conversions (slice 14). The recompute
  keeps an existing `reactivated` or `opted_out` status untouched.
- **AI category suggestions for unmapped labels:** slice 11.
- **Nightly `company_monthly_stats`:** dashboards slice (§40.15).
