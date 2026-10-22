# ADR-007: Import wizard and background jobs (Phase 1, slice 7)

- Status: accepted
- Date: 2026-10-24
- Context: spec §11 (customer import flow), §18 (imports tables), §22 (file security),
  §24 (job error handling), §26 (Inngest), §40.7, §41 (Definition of Done)

## Decisions

1. **Staging, never direct writes.** Files are processed in this order:
   1. Upload to a private `imports` bucket (`{company_id}/{import_id}/source.ext`).
   2. A parse job stages string rows in `import_rows`.
   3. The operator maps columns and declares the legal basis.
   4. A validate job writes per-row status and issues.
   5. The operator reviews.
   6. A commit job upserts in batches.

   The live tables are touched only in step 6, by
   `public.commit_import_batch`, one transaction per batch of about 500 rows
   (callable by the service role only).

2. **Background jobs.**
   - The job functions in `lib/jobs/imports.ts` are plain server-only code, wrapped
     as Inngest functions (`lib/jobs/inngest.ts`, served at `/api/inngest`, with
     retries and a per-import concurrency of 1 for commits).
   - `JOB_RUNNER=inngest` sends events, and `lib/env` requires it in production.
   - `JOB_RUNNER=inline` (the default locally and in CI) runs the same function right
     after the response via Next's `after()`, so tests need no Inngest dev server.
   - The Inngest wrapper is only type-checked locally; it needs a staging check with
     the Inngest dev server or cloud before production.
3. **Upload without a 20 MB server action.** The browser uploads to a signed upload
   URL that the operator's session creates; storage policies allow it for platform
   admins only.
   - The server re-checks everything before parsing: size, extension and magic
     bytes; `.xlsm` and other macro files are refused; a zip-bomb guard reads the
     XLSX central directory without inflating (100 MB limit).
   - CSV/TXT must not contain NUL bytes.
   - Imports require a confirmed DPA.
4. **Parsing** (`lib/domain/imports/parse.ts`):
   - **Encoding:** UTF-8 if it decodes, then BOM, otherwise Windows-1250 or
     ISO-8859-2 by letter positions; the operator can switch encoding.
   - **Delimiter:** by column-count consistency, preferring `;`.
   - **Rows:** header detection; empty and "Celkem"/"Součet" rows are skipped;
     rows with the wrong number of columns become invalid.
   - **XLSX:** read with `cellFormula: false`; all cells become strings and dates
     stay Excel serial numbers until mapping; the operator can choose the sheet.
   - **Failures:** an unclosed quote fails the whole file rather than half-importing.
5. **Mapping.**
   - Header keywords suggest the mapping.
   - The confirmed mapping is saved per company and type, applied automatically next
     time, and completed by suggestions for fields the template does not cover.
   - Extra target fields beyond the spec: `full_name_last_first` ("Příjmení Jméno",
     common in garage software) and `vehicle_full` ("Škoda Octavia" in one column).
   - `total_lifetime_value` can be mapped but is not used yet, because lifetime value
     is computed from visits.
6. **Legal basis.** One basis per batch, or a mapped consent column (truthy → consent,
   otherwise the batch basis or unknown). The operator always ticks that the owner
   confirmed it; who and when are stored on the import and on each customer
   (`legal_basis_source = import:{id}`). A later import never downgrades a known basis
   to `unknown`.
7. **Validation** follows the spec's rules exactly:
   - **Invalid:** no contact, unparseable phone, missing name, visit date missing,
     invalid or in the future.
   - **Warning:** fixed line, foreign number, suspicious e-mail, VIN, unusual price,
     visits older than 10 years.
   - **Duplicates within a file:** for customer imports, the same external ID, phone +
     surname, or e-mail; for visit imports, the same customer, vehicle, date, job and
     value.
   - **Matching existing data:** external ID, then phone + surname, then e-mail.
     Ambiguous matches are flagged and skipped at commit, never merged.
   - **Vehicles:** matched by VIN or plate within the same customer. A VIN already on
     another customer's car is dropped with a warning instead of reassigning the car.
   - **Phones** use libphonenumber-js (max metadata) with default region CZ.
8. **Idempotent commits.**
   - New customer and vehicle IDs are deterministic UUIDs from the import and row
     keys.
   - Visits carry `external_ref = imp:<hash of customer key, vehicle, date, job,
value>`.
   - Re-running a batch after a crash, or re-importing the same file, updates and
     never duplicates; this is covered by pgTAP and E2E.
   - Progress is stored per batch, so a failed commit resumes from the last batch.
9. **Lifecycle after commit.** `public.recompute_lifecycle` recomputes last visit,
   visit count, lifetime value and status for the affected customers, keeping
   `opted_out` and `reactivated`. The nightly job and the category mapping UI (slice 8) reuse it. Service categories come from the company's mappings, then keyword
   rules, otherwise `repair_other`.
10. **Review** shows counts per status, rows filtered by status (showing the source
    values of failed rows), and exclude/include per row. **"Stáhnout chyby"** is a
    UTF-8 BOM, `;`-delimited CSV with formula-injection protection.
11. **Non-production guard (spec §22).**
    - Phone numbers cannot be told apart from real ones, so files are refused when
      e-mails fall outside `example.cz`/`example.com`.
    - `DEV_ALLOW_REAL_LOOKING_DATA=true` overrides this for one specific test, and
      `lib/env` forbids the flag in production.
12. **Sending gate.** The spec §19 condition "first import reviewed" is now enforced:
    sending can be switched on only after at least one completed import.
13. **Bug found by the new pgTAP suite.** `service_role` had no usage on schema `app`,
    so any job updating customers or companies failed in the guard triggers. Fixed in
    migration `20261024120200`.

## Deferred (with reason)

- **AI mapping hint:** `maskSample` is ready and tested (letters → x/X, digits → 9).
  The provider wrapper and prompt logging arrive in slice 11; until then the hint is
  the deterministic keyword suggestion.
- **Suppression-list hits during import:** the list arrives in slice 13.
- **Retention** (source files 30 days, staging 90 days): the retention job in slice 16.
- **100,000-row load test** (spec §30, under 5 minutes): before Phase 3, per the spec.
