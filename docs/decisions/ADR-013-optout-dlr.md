# ADR-013: Opt-out, suppression, delivery reports, BulkGate adapter (Phase 1, slice 13)

- Status: accepted
- Date: 2026-11-05
- Context: spec §16 (opt-out, dispatch flow steps 5–6, message lifecycle, provider
  interface), §17 (suppression hashes, webhook verification), §18 (`suppression_list`,
  `message_events`), §42 rules 4–6, §40.13

## Decisions

1. **Opt-out link.**
   - Every message carries a random 8-character token (`messages.opt_out_token`, slice 12)
     and the link `<OPT_OUT_BASE_URL>/<token>`.
   - `/o/[token]` is public and not indexed. It shows only the shop's name and one button.
   - Opening the page changes nothing. Only the button (a server action, so a POST)
     opts out; link previews and scanners never unsubscribe anyone.
   - The button is idempotent. An unknown token is a plain 404.
   - The token lives on the message instead of a separate `opt_out_tokens` table: the
     message row already holds the company, customer and number, and `opted_out_at`
     records the click.
2. **Suppression is per company and stored as hashes.**
   - `suppression_list.address_hash` is hex HMAC-SHA256 of the E.164 number with
     `SUPPRESSION_PEPPER`. The number never appears there; a check constraint allows
     only a 64-character hex string. Hex text instead of `bytea` avoids encoding pitfalls
     through PostgREST.
   - Opting out does four things:
     1. hashes the number into the shop's list;
     2. marks every customer of that shop with the number as opted out (eligibility
        follows through the existing trigger);
     3. stops their running enrollments (`stage = opted_out`);
     4. cancels their queued messages.
   - Another shop is not affected, because it is a different controller.
   - The send job checks the list twice: at the campaign snapshot, and right before each
     send. So a re-imported or duplicate customer record with a suppressed number is
     cancelled with `suppressed`.
3. **Callbacks.**
   - `/api/webhooks/sms/[provider]` accepts only the configured provider. It verifies the
     shared secret in the URL in constant time (`?secret=`; BulkGate signs nothing).
   - It stores every event raw in `message_events`, deduplicated on
     (`provider_id`, `provider_event_id`), answers 200 at once and processes the events
     in the background (`messaging/events.requested`). The tick processes them too.
   - Delivery reports move `sent` to `delivered` or `undelivered`. A late report also
     settles a message in manual review or an expired one.
   - Inbound STOP, ODHLASIT or NE (whole message; case, diacritics and punctuation are
     ignored) suppresses the number for the shop that texted it most recently. Other
     replies are stored but not acted on; two-way SMS is Phase 2.
   - Messages without a report after 72 hours become `expired`. Expired initial
     messages do not stop follow-ups (no report is not a failure); failed and
     undelivered ones do. `due_followups` and `claim_messages` are redefined for this.
   - The mock has no callbacks, so the tick polls it for reports and stores them like
     webhooks. Tests and local runs see `delivered` and `undelivered` too.
4. **BulkGate adapter** (`lib/providers/sms/bulkgate.ts`, chosen by the owner), using the
   Simple Transactional API, JSON POST:
   - The sender is `gText` with our alphanumeric name (up to 11 characters), else
     `gSystem`. `unicode` follows our GSM/UCS-2 detection. `duplicates_check: "on"` adds
     a second guard behind our idempotency key.
   - Error mapping:
     - 5xx and 429 are retryable;
     - documented error types are permanent (`bulkgate_<type>`);
     - a network error or timeout throws, so the message goes to manual review and is
       not retried automatically.
   - Delivery reports arrive by GET (status 1 delivered, 2 queued at the operator, 3 not
     delivered, 10 inbound SMS) or as bulk JSON POST.
   - BulkGate prices are in credits, so cost uses `SMS_PRICE_PER_SEGMENT_MINOR` (CZK).
   - Tested with a fake fetch only; no request reached BulkGate. Real use needs:
     - `SMS_PROVIDER=bulkgate`;
     - `SMS_PROVIDER_API_KEY` (application_id) and `SMS_PROVIDER_API_SECRET`
       (application_token);
     - a 32+ character `SMS_WEBHOOK_SECRET`;
     - outside production, `SMS_TEST_WHITELIST`. The env check refuses anything less,
       and the dispatcher cancels non-whitelisted numbers.
   - In the BulkGate portal, set the delivery report URL to
     `https://<app>/api/webhooks/sms/bulkgate?secret=<SMS_WEBHOOK_SECRET>`.
5. **Audit event:** `customer.opted_out` (system), with the reason and the number of
   customers, never the number.

## Deferred

- Rate limiting of `/o/*` and the webhook (per IP), and the BulkGate IP allowlist:
  slice 16.
- Manual suppression and erasure from the operator UI: with the data subject request
  flow.
- Staging verification with real phones on the whitelist: needs the owner's BulkGate
  account.
