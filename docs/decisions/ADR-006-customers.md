# ADR-006: Customer list, detail and contact editing (Phase 1, slice 6)

- Status: accepted
- Date: 2026-10-23
- Context: spec §8 (Zákazníci – seznam / detail), §12 (eligibility), §20, §38.5, §40.6

## Decisions

1. **One SQL function for the list.** `public.list_customers(...)` does search, the
   four filters, the first vehicle per customer, the total count and pagination in
   one round trip.
   - It is `SECURITY INVOKER`, so RLS on customers, vehicles and visits applies
     exactly as for direct queries; a shop user asking for another company gets
     zero rows.
   - Execution is granted to `authenticated` only.
   - Results are ordered by surname and first name with the Czech collation
     (ADR-004).
2. **Search** is a single box matching name, phone or plate (any of them).
   - `lib/domain/customer-search.ts` normalises the input: it removes diacritics and
     case, and keeps only letters, digits and spaces, so no LIKE wildcards or quotes
     reach SQL.
   - Names match a stored generated column `customers.search_name` (`translate` and
     `lower` are immutable).
   - Phones match digits inside `phone_e164`; plates match `license_plate_norm`
     without the space.
3. **Eligibility filter** follows spec §12: legal basis known, mobile phone,
   not opted out, last visit within the company's `max_lookback_months` (from
   settings).
   - Suppression-list hits join with the opt-out slice (§40.13); until then the
     `opted_out` status stands in.
   - The detail page shows the exact exclusion reason using the same domain function
     as the campaign audience.
4. **Contact editing (customers.edit_contact).** Owners, managers and the operator
   may change the name, phone, e-mail and notes.
   - The phone must be Czech; its type (mobile or fixed) is derived from the
     numbering plan.
   - Audit event: `customer.updated`, with field names only.
   - The new trigger `app.guard_customer_update` stops shop users changing any other
     column, such as legal basis, identifiers or computed lifecycle columns. The
     slice 2 `customers_update` policy allowed every column, which was too broad for
     spec §20.
5. **Another company's customer** gives a 404 page; the database returns zero
   rows for reads, `list_customers` and updates (spec §38 critical scenario 5,
   covered by an E2E test).

## Deferred (with reason)

- The "Naposledy osloven" column and campaign history on the detail page: these
  need messages and enrollments (slices 10–12).
- Customer export and deletion: data-subject requests and suppression handling
  (slices 13 and 16), so that an opt-out survives deletion.
