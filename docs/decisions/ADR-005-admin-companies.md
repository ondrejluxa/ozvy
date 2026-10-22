# ADR-005: Admin companies and onboarding gates (Phase 1, slice 5)

- Status: accepted
- Date: 2026-10-22
- Context: spec §6 F1, §19, §20, §22, §23, §40.5

## Decisions

1. **Operator-only company management.** `/admin/companies/new` creates a shop
   (status `onboarding`, sending off, `service_mode = managed`, default settings).
   `/admin/companies/{id}/settings` edits the profile, the settings JSON, the DPA,
   the sending switch and users. Writes run with the operator's session, so RLS and
   `app.guard_company_update` still apply. The owner-facing "Nastavení" page
   (spec §8) is part of the client dashboards slice.
2. **Validation in `lib/domain`.**
   - `company-profile.ts` validates the IČO check digit (mod 11) and the DIČ
     (`CZ` + 8–10 digits), and normalises the postal code ("280 02") and Czech
     phones (E.164).
   - The SMS sender ID must be 3–11 ASCII letters or digits with at least one
     letter, which is the stricter common subset of carrier rules.
   - Errors are field codes translated in `messages/cs.json`.
   - The seeded IČOs had invalid check digits; their last digit was corrected.
3. **Settings JSON (spec §19).** `companySettingsSchema` (strict, used for writes)
   and `resolveCompanySettings` (lenient, used for reads: field-by-field fallback to
   the defaults) live in `lib/domain/company-settings.ts`. Defaults and allowed
   ranges:

   | Setting                     | Default       | Range                               |
   | --------------------------- | ------------- | ----------------------------------- |
   | active / at-risk thresholds | 9 / 12 months | at-risk must be greater than active |
   | lookback                    | 48 months     | 6–60                                |
   | attribution window          | 60 days       | 30–120                              |
   | holdout                     | 10 %          | 5–30 %                              |
   | expected conversion         | 6 %           | 1–30 %                              |
   | optional gross margin       | none          | 5–95 %                              |
   | message shop name           | none          | optional                            |

   The audit log records the names of changed keys, never their values.

4. **DPA in Storage.**
   - The file is stored in the private bucket `company-documents` at
     `{company_id}/dpa/{upload_id}.pdf`.
   - Upload limits: 10 MB, PDF magic bytes, PDF type. Bucket and policies are in
     migration `20261022120000`.
   - The operator inserts; the operator and that company's owner read. There are no
     update or delete policies: a replacement is a new object, and the company row
     points to the latest.
   - Downloads go through `/admin/companies/{id}/dpa`, which redirects to a
     60-second signed URL created with the operator's session and is audited
     (`company.document_downloaded`, an addition to the spec §23 list).
5. **Sending switch.** It can be turned on only once `dpa_signed_at` is set,
   enforced in three places:
   - `sendingBlockers` in the domain;
   - the action;
   - a DB check constraint, `companies_sending_requires_dpa`.

   Changing the status to anything other than active in the same edit switches
   sending off. The spec's second condition ("first import reviewed") is added with
   the import slice (§40.7).

6. **Audit events:**
   - `company.created`;
   - `company.settings_changed`, with section and field names;
   - `company.dpa_confirmed`, with the upload ID;
   - `company.sending_enabled`, with the enabled flag.
7. **Testing.**
   - The PGlite stub has a minimal `storage` schema, so the storage policies run in
     `pnpm db:test:local` as well.
   - CI now starts Supabase's storage service for the E2E suite.
