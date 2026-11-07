# First pilot test on staging (your own whitelisted phone)

Run this on **staging** (`APP_ENV=staging`) after every item in `docs/staging-readiness.md`
is ticked. Real SMS go only to numbers in `SMS_TEST_WHITELIST`; any other recipient is
cancelled with `not_whitelisted`, so a mistake cannot reach a stranger. Use fake customers
(names and `@example.cz` e-mails) with **your own** phone numbers only. Have two phones if you
can (A and B); one is enough if you run the rounds one after another.

Record each result (date, time, OK / problem, note) in a copy of this file or in the restore
drill log style.

## Before you start

- [ ] Sending happens only inside the sending window: Mon–Fri 9:00–18:00, Sat 9:00–12:00
      (Prague), never on Sundays or public holidays. Plan the session for a weekday morning.
- [ ] `/admin/system`: breaker "closed", kill switch off, provider `bulkgate`.
- [ ] Inngest dashboard: `messaging-tick` runs every minute without errors.
- [ ] A test shop ("Autoservis Pilot Test") with a signed DPA, the sender name approved by
      BulkGate, and an owner account (your second e-mail address).
- [ ] An import CSV with 3–5 fake customers. Each has a vehicle, a last visit 13+ months ago
      (so the "lapsed" preset picks them) and **your** phone number(s). Import it through the
      app (this also tests the import on hosted infrastructure).

**Two rules that would otherwise hide your phone:**

- **Holdout:** set the campaign holdout to **0 %**. Otherwise your phone can be drawn into the
  control group and never receive an SMS (that is correct behaviour).
- **Contact rules:** a customer contacted in the last 30 days is excluded. For each new round,
  use a new fake customer record (or a new test shop) with the same phone number.

## 1. Send

- [ ] Create a campaign with the first message and **two follow-ups** (minimum gap 2 days),
      holdout 0 %. Send it to the owner for approval; the owner approves it (e-mail arrives,
      link works).
- [ ] Within about a minute of the start, the SMS arrives on the phone. Check:
  - the sender name;
  - the greeting and the vehicle text;
  - Czech characters, or their correct removal if diacritics are off;
  - the opt-out link shown as a tappable link.
- [ ] In the app the message is `sent` with a BulkGate message ID; cost = segments × price.
- [ ] Nobody outside the whitelist got anything: any non-whitelisted recipient shows
      `cancelled / not_whitelisted`.

## 2. Delivery report

- [ ] Within a few minutes the message turns `delivered` (BulkGate DLR → webhook).
- [ ] `message_events` holds the event; after processing its payload has no phone number.
- [ ] Wrong secret check:
  - `curl -i "https://<staging>/api/webhooks/sms/bulkgate?secret=wrong"` gets 401;
  - nothing is recorded.
- [ ] Optional: send to a whitelisted number that is switched off for 2+ days. It ends as
      `expired` or `undelivered`, never `delivered`.

## 3. Opt-out link

- [ ] Tap the link on phone A. The page shows the shop name. Confirming shows the success text.
- [ ] Opening the link again shows "Jste odhlášeni" straight away, not an error.
- [ ] In the app:
  - the customer is marked opted out;
  - the enrollment stage is `opted_out`;
  - an audit entry exists;
  - the suppression list has a hash (no phone number in clear text).
- [ ] A made-up token (`/o/AAAAAAAA`) gives 404. Repeated wrong tokens get rate-limited.

## 4. STOP reply

- [ ] First confirm with BulkGate that replies to your sender reach the webhook. An
      alphanumeric sender usually cannot receive replies; you may need a reply-capable
      sender or number (see staging-readiness, BulkGate).
- [ ] From phone B, reply `STOP` (also try lowercase `stop` and `ODHLASIT`). Within a few
      minutes:
  - the customer is opted out;
  - the suppression hash is added;
  - the enrollment is `opted_out`;
  - the reply text and number are removed from the stored event.
- [ ] A reply that is not a keyword (e.g. "Díky, zavolám") does not opt out. It appears as a
      reply for the shop.
- [ ] If replies cannot reach the webhook, note it. The link is then the only opt-out
      channel, and the SMS text must not promise "reply STOP".

## 5. Suppression

- [ ] Create a **new** fake customer with phone A's number (same shop) and a new campaign that
      would include it:
  - the audience excludes it (eligibility "opted out"), or
  - if it slips into the queue, the dispatcher cancels it as `suppressed` at send time.

  No SMS arrives.

- [ ] Opting out applies per shop: another test shop can still message the same number (spec).
      Do this only if you want to verify it.

## 6. Follow-ups stop

Follow-ups are due 2+ days after the first SMS. Either wait, or move the first send back in
time on **staging only** in the Supabase SQL editor:

```sql
-- staging only; fake test shop only
update public.campaign_enrollments
set first_sent_at = first_sent_at - interval '3 days'
where campaign_id = '<campaign id>';
```

- [ ] Customer still subscribed and with no visit: follow-up 1 is queued and **arrives**.
- [ ] Customer that opted out (sections 3 and 4): **no** follow-up is queued or sent.
- [ ] Customer with a booking or completed job recorded (section 9): no follow-up.
- [ ] Customer with a new visit imported after the first SMS: no follow-up.
- [ ] Kill switch on in `/admin/system`:
  - due follow-ups wait and nothing is sent;
  - delivery reports and STOP replies are still processed.

  Switch it off: sending resumes with no duplicates (one SMS per step on the phone).

## 7. Circuit breaker: trip and recovery

The breaker trips when more than 20 % of at least 20 gateway attempts fail within 5 minutes.
It then pauses all sending for 15 minutes and opens an operator alert. You cannot make
BulkGate fail on purpose, so simulate the failures in the staging SQL editor:

```sql
-- staging only: pretend 20 of 20 gateway calls failed this minute
insert into public.provider_attempts (provider_id, minute, attempts, failures)
values ('bulkgate', date_trunc('minute', now()), 20, 20)
on conflict (provider_id, minute) do update set attempts = 20, failures = 20;
```

- [ ] Queue one more real send to phone A (a new fake customer and campaign):
  - at most that one SMS goes out;
  - the tick records it (21 attempts, 20 failures) and **trips**;
  - `/admin/system` shows the breaker open with "paused until";
  - an Attention Required alert is open;
  - the operator digest e-mail lists it the next morning.
- [ ] While open, queued messages stay `queued`: nothing is sent and nothing is lost.
- [ ] **Recovery by hand:** press "Zkusit bránu znovu" in `/admin/system`:
  - the next tick sends exactly one probe;
  - when the probe succeeds, the breaker closes and the alert resolves;
  - the remaining queued messages go out **once each** (check the phone and message IDs).
- [ ] **Recovery by itself:** trip it again. After 15 minutes the next tick sends exactly
      **one** probe message; it succeeds, so the breaker closes and sending continues.
- [ ] Afterwards: `delete from public.provider_attempts where provider_id = 'bulkgate';` (or
      wait 5 minutes for the window to pass).

## 8. Scheduled jobs

Check the Inngest dashboard (runs and errors) the morning after the test day:

- [ ] `messaging-tick` every minute; `messaging-events` after each webhook.
- [ ] `health-check` every 15 min:
  - `/api/health` still OK;
  - a stuck campaign or an open breaker raises an alert.
- [ ] `lifecycle-nightly` 03:00: customer stages updated.
- [ ] `stats-nightly` 03:30: monthly stats for the test shop updated.
- [ ] `retention-nightly` 04:00: runs without error. Its result lists the counts (mostly 0 on
      new data).
- [ ] `daily-digest` 06:00: the operator e-mail arrives and lists open alerts.
- [ ] Nightly backup (GitHub Actions) ran and the file is in the bucket.

## 9. Dashboard attribution

- [ ] For the customer on phone A (contacted), record a **booking**, then a **completed job**
      with a value (e.g. 4 500 Kč) inside the attribution window.
- [ ] The shop dashboard shows:
  - 1 booking;
  - 1 reactivated customer;
  - recovered revenue 4 500 Kč (formatted `4 500 Kč`);
  - the ROI uses the subscription price.

  Check the figures straight away and again after the 03:30 stats run.

- [ ] A conversion for a **holdout** customer (run one campaign with holdout 20 % and enough
      customers that one is drawn) is recorded but **not** counted as recovered revenue.
- [ ] A value over 200 000 Kč asks for confirmation; one over 500 000 Kč is refused.
- [ ] Reverting the conversion removes it from the dashboard.
- [ ] After the attribution window closes, the enrollment becomes `lost` and the buttons
      allow only corrections.
- [ ] The operator dashboard shows the same totals for the test shop.

## 10. Sign-off

- [ ] Every section passed, or the problem is written down with a decision.
- [ ] Sentry: no unexpected errors during the test; no personal data in any event.
- [ ] Delete or anonymise the test shop on staging (or keep it clearly named as a test).
- [ ] Only then set up production (`docs/staging-readiness.md`, step 13).
