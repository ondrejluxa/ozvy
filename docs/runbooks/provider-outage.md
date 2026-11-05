# SMS gateway outage

**Signals:**

- "SMS brána selhává, odesílání je dočasně pozastavené" (critical) in Attention Required: the
  circuit breaker tripped;
- "Doručitelnost SMS klesla" or "Kampaň selhala" in Attention Required;
- many `failed` / `needs_review` rows on `/admin/system`;
- BulkGate status page red;
- `bulkgate_unknown` or 5xx codes in `messages.error_code`.

## 0. What the system already did

The circuit breaker (spec §24, ADR-017) pauses sending by itself when more than 20 % of send
attempts in 5 minutes fail at the gateway (5xx, 429, timeouts), with at least 20 attempts.

- The pause lasts 15 minutes; no new campaign starts meanwhile.
- After the pause, exactly one probe message is sent:
  - success → sending resumes and the alert closes;
  - failure → another 15-minute pause.
- Messages the gateway rejected were not sent and wait in the queue. Unknown outcomes are in
  "Zprávy ke kontrole".
- The state and the reason are on `/admin/system` under "SMS brána (jistič)".

## 1. Stop the damage (2 minutes)

If the outage looks long, or you are unsure, also stop everything by hand:

1. `/admin/system` → enter a reason → **Zastavit veškeré odesílání**. Nothing starts and
   nothing is sent until you switch it back. Queued messages stay queued.
2. Tell the affected shops if a campaign was mid-send (campaign name and counts only, never
   customer data).

## 2. Find out what happened

- Retryable gateway errors (5xx, 429) are retried automatically after 1, 5, 15 and 60 minutes,
  then fail. No action is needed for short blips.
- A timeout or network error during a send means the outcome is unknown. Those messages go to
  `needs_review`, never to an automatic retry.
- Look at the gateway's own message log for the affected time range. BulkGate portal → SMS
  history.

## 3. Recover

1. When the gateway is healthy again:
   - if you used the kill switch: `/admin/system` → **Obnovit odesílání**;
   - if the breaker is still pausing: **Zkusit bránu znovu**. The next queue run sends one probe
     and resumes on success. It is audited as `system.provider_breaker_reset`.
2. **Zprávy ke kontrole:** compare each message with the gateway log and mark it **Odešla** or
   **Neodešla**. Never resend by hand. A message marked **Neodešla** stays failed, and its
   follow-ups stop.
3. Campaigns that failed at the pre-send check: campaign detail → **Vrátit do konceptu**, fix,
   submit again.
4. Delivery reports that arrived during the outage are processed from `message_events`, and
   duplicates are ignored.

## 4. Log

Record the incident in the operator's incident log: start, end, affected shops and messages,
the action taken. The kill-switch changes are in `audit_logs` (`system.kill_switch_changed`).
