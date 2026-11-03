# ADR-010: Campaigns without sending, approval flow (Phase 1, slice 10)

- Status: accepted
- Date: 2026-11-05
- Context: spec §6 F3–F4, §8 (builder steps), §12 (builder numbers, statuses, contact rules), §15
  (placeholders), §18 (campaigns, campaign_steps), §20 (campaigns.approve), §23 (audit), §40.10

## Decisions

1. **Tables.** `campaigns` and `campaign_steps` follow spec §18, plus
   `approved_recipient_count`, `submitted_by` and `submitted_at`. The send job (slice 12) compares the count with the recipients at send time; a drift above 20 %
   pauses the campaign (spec §12 pre-send check 6). Database checks enforce the step
   rules: step 0 at send time, at most two follow-ups, at least 2 days apart.
   `campaign_enrollments` and the holdout snapshot are created at send time (F3.6),
   so they arrive with the send job. The seeded holdout selection already exists
   (`selectHoldout`) and is tested.
2. **The status machine is enforced twice.**
   - `lib/domain/campaigns/status.ts` maps each event to its allowed source statuses.
     The diagram alone was not enough: "approve" from a draft would have matched the
     legal draft → scheduled edge.
   - `app.campaign_transition_allowed` and the `campaigns_guard_update` trigger refuse
     any other transition from any write path.
   - Content is frozen outside draft: rules, holdout, schedule and steps. What was
     approved is what gets sent.
3. **Approval.**
   - In operator-approved shops, the operator's submit schedules the campaign after an
     explicit confirmation checkbox.
   - In client-approval shops, the campaign goes to `waiting_for_approval` and every
     owner gets "Kampaň čeká na schválení" by e-mail. The e-mail carries the campaign
     name, recipient count, send time and link, no customer data.
   - The link opens a phone-friendly page with the rendered messages and "Schválit" /
     "Vrátit s komentářem". A returned campaign goes back to draft with the comment;
     the operator edits it (`…/edit`) and resubmits.
   - The operator cannot approve on the owner's behalf, and managers cannot decide.
     This is enforced in the domain (`canDecideApproval`), in RLS (the owner's update
     policy applies only where the shop approves itself) and in the guard trigger
     (owners may change only the status, waiting → scheduled or draft, and the
     approval fields).
4. **Builder** (new client component; the Phase 0 builder stays for the demo):
   - **Segment:** a preset or saved segment, eligible and excluded counts, holdout
     0–20 %, expected revenue. The average job value is the median of the segment's
     categories with at least 20 visits (`public.job_value_median`), otherwise the
     company average.
   - **Message:** initial message plus up to 2 follow-ups. The mock AI generator is
     used until slice 11. There are placeholder chips, a live SMS segment counter, a
     strip-diacritics toggle, and a preview of 5 real recipients including one without
     a vehicle (spec §15).
   - **Timing:** only inside the sending window and in the future.
   - **Review:** recipients, total segments, SMS cost, expected revenue.

   The server re-checks content, segment and recipients on create and on submit.

5. **Performance: owner rights for segment functions.** As `SECURITY INVOKER`,
   `segment_audience` evaluated RLS policy functions for every visit row its
   correlated subqueries scanned. On the 3,200-customer shop that took 2.9 s versus
   48 ms, and the builder's parallel queries hit the 8 s statement timeout.
   - `segment_audience`, `list_customers` and `job_value_median` now run as the owner
     (`SECURITY DEFINER`).
   - Each one authorises the caller itself, the same way RLS would: the service role,
     or `app.can_read_company(p_company_id)`. Otherwise it returns nothing.
   - Every row they read is scoped to `p_company_id`.
   - The existing cross-tenant pgTAP checks (05, 08) still pass, and all three
     functions now take 5–45 ms.
6. **Audit events:** `campaign.created`, `updated`, `deleted`, `submitted`,
   `approved`, `rejected`, `scheduled`, `cancelled`.

## Deferred

- Enrollments, holdout snapshot, pre-send checks, dispatch and pause/resume: slice 12.
- The real AI provider for generate and rewrite: slice 11.
- Expected-revenue snapshot on the campaign (`avg_job_value_minor_snapshot`): set at
  the send-time snapshot in slice 12.
