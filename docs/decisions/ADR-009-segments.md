# ADR-009: Segments, compileSegment and the audience pipeline (Phase 1, slice 9)

- Status: accepted
- Date: 2026-11-04
- Context: spec §12 (segment DSL, presets, contact rules), §18 (segments), §20 (segments.manage), §40.9,
  §41 (preset counts proven by fixture tests)

## Decisions

1. **compileSegment lives in the database.**
   - `app.compile_segment(rules)` turns the spec's JSON DSL into a SQL boolean
     expression plus a parameter array.
   - Every value is bound (`$1->N` with `EXECUTE … USING`), never written into the
     SQL text. Fields and operators come from a whitelist; anything else raises
     `22023`, and a hostile value fails its type cast (`22P02`). Both are tested.
   - Compiling in SQL needs no new Postgres driver and no "run this SQL" endpoint.
     `public.segment_audience` runs the compiled SQL with the caller's rights
     (security invoker), so RLS applies to every table it reads.
   - The TypeScript evaluator from Phase 0 stays for the demo.
2. **DSL coverage.**
   - Operators: `eq`, `in`, `gte`, `lte`, `between`, `between_months_ago`,
     `older_than_months`, `season_last_year_not_this`, `percentile_gte`.
   - Groups: `all`, `any`.
   - Fields: `vehicle.last_visit_at` (optionally per service category),
     `vehicle.visits_since`, `vehicle.max_visits_24m`, `customer.lifetime_value`,
     `customer.lifecycle_status`.
   - `lib/domain/segments/schema.ts` validates rules with Zod before they are stored
     or sent, capped at 20 conditions and depth 3.
3. **Audience pipeline, as in spec §12:**
   1. rule matches per unit (a vehicle, or a customer without one);
   2. one unit per customer, the most overdue;
   3. eligibility: the stored `eligibility_reason` (ADR-008);
   4. contact rules: 30 days, 4 threads per rolling 12 months, same preset on the
      same vehicle within 90 days.

   `segment_preview` returns matched, eligible and excluded-per-reason counts.
   - The lifetime-value percentile matches the demo: the share of the shop's
     customers spending strictly less, with 0 for no spend.
   - "Too old" uses the customer's last visit (the stored eligibility), not the
     chosen car's.

4. **Contact history** comes from the view `app.contact_events` (company, customer,
   vehicle, preset, sent_at). It is empty until messaging (slice 12) redefines it over
   messages; the pgTAP suite feeds it by hand to prove the three rules now.
5. **Fixture tests (DoD).** `supabase/tests/database/08_segments.test.sql` builds a
   12-customer shop and asserts the exact matched, eligible and excluded counts of
   all 9 presets on 15. 10. 2026, plus every operator. Its preset rules must equal
   `PRESETS` byte for byte; `tests/unit/segments.test.ts` checks that, so SQL and
   TypeScript cannot drift apart.
6. **Segments table and UI.**
   - `segments` has RLS: shop members read, the operator writes. It is in the tenant
     harness.
   - The "Segmenty" tab shows the presets with live counts and availability (out of
     season, no STK data), the saved segments, and a builder: last-visit range with
     categories, "nothing since", status, top spend share, minimum visits in 2 years.
   - The builder previews counts, exclusion reasons and 5 sample customers before
     saving; a saved segment can be archived.
   - Segment actions are not in the spec §23 audit list, so they are not audited.

## Deferred

- **Expected revenue per segment** (median job value per category, conversion rate)
  belongs to the campaign builder in slice 10.
- **Editing the rules of a saved segment:** create a new one and archive the old one.
  Campaigns snapshot rules anyway (spec §19).
