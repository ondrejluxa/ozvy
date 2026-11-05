# Suspected data leak or unauthorised access

Customer data belongs to the shops (the controllers); we are the processor. Under the DPA we
must tell an affected shop without undue delay, so the shop can meet its 72-hour obligation
toward the Czech data protection authority (ÚOOÚ).

## 1. Contain (first hour)

1. **Stop sending:** `/admin/system` → **Zastavit veškeré odesílání**.
2. **Revoke access:**
   - remove the suspicious user's memberships;
   - in Supabase Auth, sign out all of their sessions and disable the user;
   - for an operator account, remove the `platform_admins` row.
3. **Rotate secrets** if any may be exposed (see [deploy.md](deploy.md#rotate-secrets)):
   - `SUPABASE_SERVICE_ROLE_KEY` (rotate the JWT secret in Supabase);
   - `SMS_PROVIDER_API_SECRET`;
   - `SMS_WEBHOOK_SECRET` (update the BulkGate callback URL);
   - `INNGEST_SIGNING_KEY`;
   - `AI_API_KEY`.

   `SUPPRESSION_PEPPER` cannot rotate without re-hashing: keep it unless it leaked.

4. Preserve evidence: export `audit_logs` for the period, plus the Vercel and Supabase logs.

## 2. Assess

- **Who accessed what:** read `audit_logs` (`auth.login`, `admin.support_view_started`,
  `customer.*`, `import.*`) and the Supabase auth logs.
- **Cross-tenant exposure:**
  - run `supabase test db` (the tenant isolation harness covers every tenant table);
  - check new code paths that use the service role, which must always filter by
    `company_id`.
- **Which data:** names, phones, plates, visits, job values. Suppression entries are hashes
  only.

## 3. Notify and log

- Notify each affected shop owner in writing: what happened, which data, from when to when,
  what we did.
- Record the incident: timeline, root cause, fix, notifications sent.
- Add a regression test (pgTAP for RLS, end-to-end for UI paths).
