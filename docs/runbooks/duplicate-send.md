# A customer received the same SMS twice

By design this should not happen:

- every message has a unique `idempotency_key` (`sha256(enrollment:step)`, unique index);
- the dispatcher claims rows with `FOR UPDATE SKIP LOCKED`;
- rows stuck in `sending` go to manual review and are never retried automatically;
- BulkGate drops the same text to the same number within 5 minutes (`duplicates_check`).

The behaviour is covered by `tests/e2e-supabase/dispatcher-crash.spec.ts`.

## 1. Stop

If more than one customer is affected, use **Zastavit veškeré odesílání** on `/admin/system`.

## 2. Find the cause

Look up the messages to that number (operator SQL, read-only):

```sql
select id, campaign_id, step_number, status, idempotency_key, provider_message_id, sent_at, error_code
from messages
where to_address = '+420…'
order by queued_at;
```

| What you see                                             | Meaning                                                                                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Two rows with different `step_number`                    | The initial message and a follow-up, both legitimate. Check the delay and the stop conditions.                                              |
| Two rows in different campaigns                          | The contact rules should block this (30 days between campaigns). Check `app.contact_events` for that customer and the campaign start times. |
| One row, two deliveries                                  | A gateway-side duplicate. Look for the `provider_message_id` in the BulkGate log and open a ticket with BulkGate.                           |
| A `needs_review` row marked **Odešla** and a second send | Someone resent by hand. Never do that.                                                                                                      |

## 3. Recover and log

- Apologise to the shop, without customer data in e-mail.
- If the customer asks, opt them out (link or STOP reply). The suppression applies at once.
- Record the incident, the cause and the fix. Add a test that reproduces it.
