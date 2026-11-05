# ADR-015: Dashboards, Attention Required and the operator digest (Phase 1, slice 15)

- Status: accepted
- Date: 2026-11-05
- Context: spec §9 (client dashboard), §10 (super admin dashboard, alert rules), §14 (KPI
  formulas), §18 (`alerts`), §25 (daily digest), §41 (dashboard within a minute, 390 px),
  §40.15

## Decisions

1. **Client Přehled.**
   - **Data sources:**
     - Hero and KPIs read `company_monthly_stats`. Conversion edits recompute it in the same
       transaction (slice 14), so a marked return shows at once.
     - "Vrácení zákazníci" (distinct customers) and the recent returns come straight from
       `conversions`.
   - **Hero:** recovered revenue this month, the change against last month, and the total
     since the start.
   - **Five KPI cards:** returned customers, bookings, sent SMS, subscription, ROI.
   - **Chart:** 12 months of revenue against the subscription.
   - **Lists:** up to 3 current campaigns with window progress, the last 5 returns, and up to
     3 opportunities. Opportunities are presets ranked by expected revenue (eligible ×
     conversion rate × the segment's median job value), shown read-only with the
     managed-service note.
   - Single column on phones; the end-to-end test checks 390 px with no horizontal scroll.
   - Holdout returns never count.
2. **Client Výsledky.**
   - Shows revenue by month (all months with data), by campaign and by preset, plus the
     pooled holdout comparison across the shop's campaigns (from 30 holdout customers).
   - Data comes from `public.campaign_summaries` (security invoker, RLS applies): one query
     per page instead of one per campaign.
3. **Subscription price.** `companies.subscription_price_minor` is entered by hand in the
   company profile ("Měsíční předplatné", spec §20 "manual entry in MVP"). ROI is recovered
   revenue ÷ price, shown as "—" while the price is 0. MRR is the sum over active shops.
4. **Attention Required.**
   - The first six rules of spec §10, evaluated by the existing pure `evaluateAlerts` plus
     the new import rule:

     | Rule                | Fires when                                                                                  | Severity |
     | ------------------- | ------------------------------------------------------------------------------------------- | -------- |
     | campaign failed     | status `failed`, or more than 5 % of initial messages failed                                | critical |
     | import needs review | waiting in `needs_review`, or committed in the last 7 days with more than 10 % invalid rows | high     |
     | awaiting approval   | waiting more than 48 h since submission                                                     | medium   |
     | SMS failure rate    | delivery rate below 90 % over the last 200 finished messages (only from 50)                 | high     |
     | no campaign running | active shop with no send in 35 days                                                         | medium   |
     | low conversion      | under 2 % completed after 45 days, at least 100 recipients                                  | medium   |

     ROI and opportunity alerts stay with Phase 2.

   - `public.alert_inputs()` (service role) gathers the inputs for every open shop in one
     query.
   - The health check (`lib/jobs/alerts-core.ts`) keeps `alerts` in step:
     - a new issue opens a row;
     - an unchanged issue keeps its row;
     - a gone issue is resolved, not deleted.
   - A partial unique index allows one open alert per dedupe key. `created_at` is when the
     alert opened (used by the digest); `detail.since` is when the issue began (age in the
     UI).
   - It runs every 15 minutes on Inngest, before the digest, from the overview's
     "Zkontrolovat teď" button, or locally with `pnpm jobs:health`.
   - The overview shows "Vše běží normálně · poslední kontrola HH:MM" when nothing is open.
5. **Admin overview.**
   - Six KPIs: active clients, MRR, messages this month, clients' recovered revenue, active
     campaigns, failures in 7 days.
   - Attention Required, with one action per alert. The new "Otevřít import" action leads
     to the import.
   - The clients list shows a health dot (red, amber or green from open alerts; red first),
     MRR, revenue this month, ROI, last campaign and open alerts.
   - Inviting users moved to the clients page (`/admin/companies`).
6. **Daily digest**, 06:00 Prague, sent to every platform admin:
   - alerts opened and resolved in the last 24 h;
   - SMS sent and failed;
   - campaigns scheduled today.

   The subject is "Vše v pořádku · 3 kampaně dnes" when nothing is open, else "Vyžaduje
   pozornost: N upozornění · …". Formatting is pure (`lib/domain/alerts/digest.ts`, Czech
   plurals); the health check runs first.

## Deferred

- ROI below 1, unreviewed matches, stale data, payment overdue, large opportunity and
  bookings without a value after 21 days: Phase 2 rules on the same health check.
- "Požádat o kampaň" on opportunity cards (notify the operator): with notifications.
- A seeded campaign history for the local stack: dashboards fill from real local runs
  (`pnpm jobs:tick`, conversion buttons).
