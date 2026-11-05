# Runbooks

Short, do-this-now guides for incidents and routine operations (spec §30). Each one starts with
how to stop the damage, then how to find the cause, then how to recover and what to log.

| Situation                                  | Runbook                                      |
| ------------------------------------------ | -------------------------------------------- |
| SMS gateway down, failing or slow          | [provider-outage.md](provider-outage.md)     |
| A customer got the same SMS twice          | [duplicate-send.md](duplicate-send.md)       |
| Suspected data leak or unauthorised access | [data-leak.md](data-leak.md)                 |
| A migration failed in production           | [failed-migration.md](failed-migration.md)   |
| Restore the database from the nightly dump | [restore-from-dump.md](restore-from-dump.md) |
| Deploy to production, rotate secrets       | [deploy.md](deploy.md)                       |
| Restore drill results                      | [restore-drill-log.md](restore-drill-log.md) |

## Where things are

- **Global send kill switch:** `/admin/system` → "Zastavit veškeré odesílání". It stops every
  campaign start and every SMS until it is switched back; queued messages wait.
- **Per-shop switch:** company settings → "Odesílání SMS".
- **Stuck messages:** `/admin/system` → "Zprávy ke kontrole". They are never resent
  automatically.
- **Attention Required:** `/admin`. It is re-evaluated every 15 minutes, or on demand with
  "Zkontrolovat teď".
- **Health probe:** `GET /api/health` returns 200 `{status:"ok"}`, or 503 when the database
  does not answer.
- **Jobs:** Inngest dashboard (production). Locally: `pnpm jobs:tick`, `pnpm jobs:nightly`,
  `pnpm jobs:health`, `pnpm jobs:retention`.
- **Audit log:** the `audit_logs` table (append-only). Every operator action and every system
  job writes there.
