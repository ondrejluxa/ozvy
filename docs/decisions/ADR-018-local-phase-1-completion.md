# ADR-018: Phase 1 completion that needs no external service

- Status: accepted
- Date: 2026-11-13
- Context: the gaps that ADR-017 and the Definition of Done listed as not built:
  - the client "Nastavení" page;
  - user management;
  - data subject requests;
  - the audit log viewer;
  - the all-campaigns view;
  - retention for imported customers;
  - the §23 audit actions;
  - smaller spec differences.

  Everything here runs on the local stack; nothing needs an account or a real credential.
  Phase 2+ features stay out.

## Decisions

1. **All-campaigns view** (`/admin/campaigns`, spec §8).
   - On real data the page was behind "Tato část se připravuje". Its demo query would throw
     outside the demo.
   - It now runs one query per shop, each filtered by that shop's company ID, merged newest
     first. There is a shop column, and the same grouping as the per-shop list.
2. **Client settings** (`/app/settings`, spec §8). Tabs:
   - **Profil servisu:** the owner edits contact details and opening hours only. The name,
     IČO, DIČ, SMS sender, prices and rules stay with the operator; they appear in messages,
     contracts and forecasts.
   - **Uživatelé.**
   - **Data a soukromí:** DPA download, the shop's requests, retention.
   - **Historie změn:** a simplified audit log.

   Managers see the profile and users read-only. The operator's support view reads everything
   and changes nothing.

   The **Oznámení** tab is not built. Notification preferences belong to the monthly results
   e-mail (Phase 2); Phase 1 notifications go to the operator only.

3. **User management** (spec §20 users.invite, §23):
   - Owners and the operator change roles, remove members and revoke pending invitations.
     Managers cannot.
   - A shop always keeps one owner. This is checked in three places: the domain rule
     `memberChangeIssue`, the action, and the database trigger `app.keep_last_owner`. The
     trigger applies to signed-in users; cascades from deleting a company or a user account
     pass through.
   - Owners can no longer insert a membership directly. That closes the ADR-017 "invitation
     bypass": new members join through invitations (service role) or the operator.
   - Audit: `user.role_changed` (old and new role), `user.removed`, `user.invitation_revoked`.
4. **Data subject requests** (spec §21, table `data_subject_requests`):
   - `subject_reference` is the customer's UUID, never a name or number. The log holds no
     personal data, and a restore can re-apply erasures from it.
   - One open request per customer and type. The request is due 30 days from filing (Prague
     calendar). The alert `dsr_due` opens at day 20.
   - A managed owner can only **request** access or erasure (spec §20, the `customers.export`
     permission), from the customer page. The operator records any type
     (access, erasure, rectification, objection) and completes or rejects requests on the
     company's "Ochrana údajů" tab.
   - **Access:** a JSON export of everything held about the person, with internal IDs left
     out. The file name contains no personal data. Each download writes `customer.exported`.

     The spec's "PDF summary" is not generated: no PDF library for one document. The JSON is
     complete, and a summary can be printed from the browser. Revisit if a shop asks.

   - **Erasure** (`public.erase_customer`, operator only, aal2):
     1. The number is added to the suppression list (reason `erasure`), so a re-import never
        messages the person again.
     2. Their message texts and numbers are redacted. The message rows stay for statistics.
     3. Raw import rows matching the customer are deleted (by match, phone, e-mail or external
        ID).
     4. The customer is deleted; vehicles, visits, enrollments and conversions cascade. Monthly
        statistics keep their anonymous totals.

     It is audited as `customer.deleted` with counts.

   - **Objection:** the number is suppressed for this shop (reason `manual`), and queued
     messages are cancelled.
   - **Rectification:** the operator edits the customer, then closes the request.
   - Audit: `dsr.created`, `dsr.completed` (a rejection is `dsr.completed` with
     `outcome: rejected`).
5. **Retention by real inactivity** (spec §21):
   - The flag uses the last visit (or, without any visit, when the record entered the system)
     and no contact in two years. It no longer uses the record's creation date, which never
     fired for imported customers.
   - A visit or a contact since flagging lifts the flag.
   - After 30 days the customer is erased the same way as an erasure request, so message texts
     and raw import rows go too.
   - The shop objects with "Ponechat všechny" (`keep_flagged_customers`, owner or operator): the
     flag is cleared and the customer is not flagged again for a year. Audit:
     `customer.retention_kept`.
6. **Alerts** (spec §13):
   - `import_stuck`: an import still parsing, validating or committing 30 minutes after its last
     update. With Inngest retries that means the job died. See `docs/import-flake.md`.
   - `dsr_due`: an open request at day 20.
7. **Audit log** (spec §23):
   - **Screens:** a company tab ("Historie změn"), the whole log on `/admin/system/audit` (sign-ins
     and events without a shop), and the owner's simplified history (no technical details).
   - **Filters:** event group and date range (whole Prague days), 50 rows per page. Filters are
     in the URL.
   - **Names follow §23:**
     - `campaign.send_started` / `campaign.send_completed` (were `campaign.started` /
       `completed`);
     - `conversion.marked` with the stage (was `booked` / `completed`);
     - `conversion.revenue_changed` with the old and new value (was `updated`);
     - `conversion.reverted` is kept as an extra.

     No production rows exist, so nothing is migrated.

   - `admin.company_viewed` is written once per operator sign-in and shop. The deduplication
     uses the operator's latest `auth.login`, because the session has no ID the app can read.
   - **Not written, intentionally:**
     - `admin.write_mode_enabled`: support view has no write mode; it stays read-only, the
       stricter choice;
     - `conversion.confirmed_bulk`: bulk confirmation belongs to visit re-import matching
       (Phase 2).
8. **Login lockout** (spec §22): 5 failed sign-ins per e-mail in 15 minutes, then locked for the
   rest of the window. Per IP the limit is 20, so a workshop behind one address is not locked
   out by a colleague, while password spraying still is.
9. **Unused configuration removed:** `SUPABASE_DB_URL`, `EMAIL_PROVIDER_API_KEY` and
   `UPSTASH_REDIS_*`. Rate limits live in Postgres, e-mail uses `SMTP_URL`, and backups use
   `BACKUP_DATABASE_URL`.
10. **Error states and accessibility:**
    - **Error boundaries:** inside the operator and client shells (retry, error ID), so the
      navigation stays usable.
    - **No route-level `loading.tsx`:** streaming would turn the cross-shop 404 (spec §38.5)
      into a soft 200. Actions show their own pending state.
    - **Contrast:** the `faint` text colour is darker, #73737b, which passes WCAG AA.
    - **Navigation:** a "Přeskočit na obsah" skip link and a labelled main navigation.
    - **MFA QR code:** it now has alt text.
    - **Empty states:** they now say what happens next.
11. **Dead code removed:** the demo-store `suppressPhone`, `presetValueCategories` and
    `formatShortDate`. No TODO or FIXME markers exist in the code.

## Tests

- **Database:**
  - `17_settings_dsr.test.sql`: request rights, erasure, retention by inactivity, the
    objection, membership guards, alert inputs;
  - the tenant harness covers `data_subject_requests`.
- **Unit:**
  - `privacy.test.ts`, `users.test.ts`, `audit-filters.test.ts`, `shop-contact.test.ts`;
  - alert rules in `dashboards.test.ts`;
  - the login limit in `hardening.test.ts`;
  - routes in `real-data-routes.test.ts`;
  - action guards.
- **Supabase end-to-end (`settings-privacy.spec.ts`):**
  - the owner's settings and users;
  - the manager's read-only view;
  - request → export → erasure;
  - retention objection;
  - audit filters;
  - all campaigns;
  - 390 px;
  - both alerts.
- **Updated assertions:** `conversions.spec.ts` and `messaging.spec.ts` (§23 names);
  `hardening.spec.ts` (five attempts).
