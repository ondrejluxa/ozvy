# ADR-012: Messaging, dispatcher and send safety (Phase 1, slice 12)

- Status: accepted
- Date: 2026-11-05
- Context: spec §12 (campaign statuses, pre-send checks, contact rules), §16 (provider interface,
  message lifecycle, dispatch flow, follow-up stop conditions), §18 (`campaign_enrollments`,
  `messages`), §20 (System page, kill switch, `campaigns.pause`), §42 rules 4, 5 and 8, §40.12

## Decisions

1. **One tick, injected dependencies.** `lib/jobs/messaging-core.ts` `runMessagingTick` takes the
   database client, the provider, the clock, the rate and the opt-out base. In production
   Inngest runs it every minute with concurrency 1 (`messaging-tick`). Locally there is no
   cron, so it runs through:
   - `pnpm jobs:tick [--now=…]`;
   - the "Zpracovat frontu teď" button on the System page;
   - end-to-end tests that call it directly with a fixed clock, so the tests also work
     outside the sending window.

   Each tick does the following, in order:
   1. Flags messages stuck in `sending` for more than 10 minutes as `needs_review`.
   2. Stops if the global kill switch is on.
   3. Starts due campaigns.
   4. Queues due follow-ups.
   5. Dispatches messages.
   6. Moves campaigns from sending to active, and from active to completed.

2. **Start = lock + checks + snapshot.**
   - Moving a campaign from `scheduled` to `sending` under a status filter is the lock.
   - Outside the sending window (holidays included), or while the global switch is off, the
     campaign simply stays scheduled. This is the spec's "reschedule to the next window".
   - The snapshot checks (`checkSnapshot`):

     | Check                                                                          | Result if it fails                                                              |
     | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
     | Company not paused or closed, and its send switch on                           | `failed`                                                                        |
     | Every step renders for every recipient                                         | `failed`                                                                        |
     | At least one recipient                                                         | `failed`                                                                        |
     | Provider credit covers the estimate × 1.2, when the provider reports a balance | `failed`                                                                        |
     | Recipient count within ±20 % of the approved count                             | snapshot is created, but the campaign goes to `paused` with a reason for review |

   - A failed campaign goes back to draft through "Vrátit do konceptu".
   - **Snapshot:**
     - The audience is re-evaluated at send time (`campaign_audience`: contact rules,
       eligibility and caps).
     - The holdout is the seeded `selectHoldout`; holdout enrollments get a window but no
       message.
     - Step-0 messages are written with `idempotency_key = sha256(enrollment_id:step_id)` and
       a random 8-character opt-out token.
     - The average job value snapshot is stored for revenue figures.
3. **Outbox and claim.**
   - `claim_messages` (service role, `FOR UPDATE … SKIP LOCKED`) claims due queued
     messages. It skips companies that may not send and paused campaigns. Claimed messages
     are marked `sending` with an attempt before the provider call.
   - Each claimed row comes with a stop reason computed in SQL:
     - the campaign is cancelled, failed or completed;
     - the recipient is in the holdout;
     - the customer was deleted or became ineligible (opted out, no legal basis, …);
     - the phone number changed;
     - the enrollment was stopped or moved past "contacted";
     - for follow-ups: the initial SMS was not delivered, or the customer visited after the
       first SMS.

     Stopped rows are cancelled, never sent.

   - Rate limit: one send every `1000 / SMS_RATE_PER_SECOND` ms, at most rate × 50 per
     tick.
   - Retryable errors back off 1, 5, 15 and 60 minutes and fail after 5 attempts.
     Permanent errors fail at once.
   - A provider exception, where the outcome is unknown, goes straight to `needs_review`.
   - The operator resolves `needs_review` rows on the System page (sent or not sent). RLS
     allows only the transition from `needs_review` to `sent` or `failed`.
   - A real provider outside production sends only to `SMS_TEST_WHITELIST`; other
     messages are cancelled with `not_whitelisted`.
4. **Follow-ups.**
   - `due_followups` lists enrollments whose first SMS was sent or delivered and whose delay
     has passed. Holdout, stopped, ineligible and returned customers are excluded, as are
     enrollments that already have that step. The stop conditions are checked again at
     claim time.
   - Follow-ups wait while a campaign is paused.
5. **Pause, resume, cancel.**
   - Pausing keeps queued messages queued: the claim skips paused campaigns, so resuming
     continues exactly where it stopped. This deviates from the spec's "queued → cancelled
     on pause" because that would lose the rest of the campaign on resume.
   - Cancelling does cancel the queued messages.
   - The shop owner may always pause (`campaigns.pause`). Resuming, cancelling and returning
     to draft are operator only.
   - Audit events: `campaign.started`, `failed`, `paused`, `resumed`, `completed`,
     `returned_to_draft`, `system.kill_switch_changed`, `message.review_resolved`. The job
     writes its own events with `actor_type = 'system'`.
6. **Completion.**
   - Sending becomes active when no step-0 message is pending.
   - Active becomes completed when nothing is pending, every follow-up delay has passed and
     the last attribution window has closed.
   - A start that died before the snapshot fails after 15 minutes (`start_interrupted`).
7. **Contact history.** `app.contact_events` now reads contacted enrollments (the holdout
   excluded), so the 30-day, yearly-cap and same-preset-90-day rules from slice 9 apply to
   real sends.
8. **Global kill switch.** A singleton `platform_settings` row. Only the operator can read or
   change it; a reason is required to stop.

## Deferred

- Opt-out page and suppression list using `messages.opt_out_token`; DLR webhooks and
  `message_events`; the real provider adapter: slice 13. Until then mock messages stay `sent`.
- The `messaging_accounts` table (per-company provider and price): the provider comes from the
  environment and the price from the mock adapter while there is one provider.
- The `public_holidays` table: holidays, including Easter, are computed in
  `sending-window.ts` and unit-tested.
- Provider circuit breaker and alerts (spec §24): slice 16.
