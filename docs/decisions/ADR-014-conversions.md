# ADR-014: Conversions, attribution and monthly stats (Phase 1, slice 14)

- Status: accepted
- Date: 2026-11-05
- Context: spec §6 F5, §14 (attribution, pipeline, sources, formulas, storage), §18
  (`conversions`, `company_monthly_stats`), §20 (`conversions.mark`), §42 rule 8, §40.14

## Decisions

1. **One write path for every rule.**
   - `public.record_conversion(company, enrollment, action, at, revenue, user)` runs as
     the service role. The action checks `conversions.mark` (owner, manager, operator)
     first, then calls it.
   - It enforces:
     - **Transitions:**

       | Action   | From                | To / effect                                                                       |
       | -------- | ------------------- | --------------------------------------------------------------------------------- |
       | book     | contacted           | booked, source `manual_unverified`                                                |
       | complete | contacted or booked | completed with a job value, `manual_confirmed`, `confirmed_by` and `confirmed_at` |
       | edit     | completed           | new value or date                                                                 |
       | revert   | any recorded result | back to contacted while the window is open, else lost                             |

     - **The attribution window:** it starts at the first SMS (for the holdout, at the
       campaign start) and ends at `window_ends_at`. A customer whose SMS never went out
       cannot convert.
     - **Last touch:** if a newer campaign's first SMS reached the customer before that
       date and its window covers it, the older campaign is refused
       (`conversion_newer_campaign`).
   - The enrollment stage follows the conversion. A check constraint requires a date and a
     value for `completed`.
   - Clients have read-only RLS; there are no direct writes.
   - The TypeScript domain (`lib/domain/attribution/conversions.ts`) mirrors the window
     and the allowed actions to choose the buttons, picks the last-touch enrollment, and
     parses job values ("4 800 Kč", up to 500 000 Kč).
2. **Holdout.** Holdout returns are recorded identically with `is_holdout`. They never count
   in recovered revenue, completed jobs or ROI. They appear only in the comparison, which
   needs at least 30 holdout customers per campaign, else "Nedostatek dat pro porovnání".
   Incremental revenue uses the existing `holdoutComparison`.
3. **Monthly stats are rebuilt from raw rows.**
   - `company_monthly_stats` (Prague months) holds, per company and month:
     - recovered revenue and completed jobs (non-holdout, by completion month);
     - bookings;
     - sent messages, segments and SMS cost;
     - pooled holdout cohorts: treated by first-SMS month, holdout by campaign-start month,
       with the completed returns of each.
   - A trigger on `conversions` recomputes the touched months in the same transaction, so
     the client dashboard is current at once (spec §41: within a minute).
   - The messaging tick recomputes the current and previous month for companies with
     running campaigns. The nightly job (03:30 Prague, after the lifecycle recompute)
     rebuilds both months for every company.
   - Deleting the table and calling `recompute_monthly_stats` gives the same numbers
     (pgTAP).
4. **Closing windows.** `close_attribution_windows(now)` moves contacted or booked enrollments
   whose window closed to `lost` (a booked conversion becomes `lost` too). It runs in the
   tick and in the nightly job.
5. **UI.**
   - The campaign page (operator and client) shows results:
     - recovered revenue, completed, booked, return rate;
     - the holdout comparison;
     - recipients with filters (`?stav=` all, contacted, booked, completed, lost, holdout),
       50 per page, with the pipeline buttons.
   - The customer page lists the customer's campaigns with stage, value and the same
     buttons.
   - The "Dokončeno" dialog takes the value and the date, kept inside the window.
   - Audit events: `conversion.booked`, `completed`, `updated`, `reverted`.

## Deferred

- `import_matched` conversions (visit re-import matching): Phase 2.
- Asking the operator to confirm bookings with no value after 21 days, and the "low
  conversion" alert: slice 15 (dashboards and Attention Required).
- A seeded campaign history for the local Supabase world (dashboards): slice 15.
