import type { LegalBasis, ServiceCategory } from "../../db/types";
import { categorizeService } from "./normalize";
import type { ExistingData, NormalizedRecord, RowResult } from "./validate";

/**
 * Commit planning (spec §11 step 7). Rows that passed validation (valid or
 * warning, not excluded, not ambiguous) are grouped per customer and cut into
 * batches of about 500 rows; each batch is written in one transaction by
 * public.commit_import_batch.
 *
 * IDs and visit keys are derived from the import and stable row keys, so
 * re-running a batch (after a crash) or re-importing the same file updates
 * the same rows instead of creating duplicates.
 */

export const COMMIT_BATCH_ROWS = 500;

export interface CommitContext {
  importId: string;
  /** Batch legal basis, or null when a consent column is mapped. */
  declaredBasis: LegalBasis | null;
  recordedAt: string;
  existing: ExistingData;
  companyMappings: Map<string, ServiceCategory>;
  /** Deterministic UUID from a string key (sha-256 based in the job). */
  idFor: (key: string) => string;
  /** Short stable hash for visit external_ref. */
  hash: (key: string) => string;
}

export interface CommitBatch {
  rowNumbers: number[];
  customers: {
    id: string;
    external_id: string | null;
    first_name: string | null;
    last_name: string | null;
    phone_e164: string | null;
    phone_type: string;
    email: string | null;
    legal_basis: LegalBasis;
    legal_basis_source: string | null;
    legal_basis_recorded_at: string | null;
    notes: string | null;
  }[];
  vehicles: {
    id: string;
    customer_id: string;
    brand: string | null;
    model: string | null;
    model_year: null;
    license_plate_display: string | null;
    license_plate_norm: string | null;
    vin: string | null;
  }[];
  visits: {
    customer_id: string;
    vehicle_id: string | null;
    visited_at: string;
    service_type_raw: string | null;
    service_category: ServiceCategory;
    job_value_minor: number | null;
    external_ref: string;
  }[];
}

export function committableRows(results: RowResult[]): RowResult[] {
  return results.filter(
    (r) => (r.status === "valid" || r.status === "warning") && !r.ambiguous && r.normalized !== null,
  );
}

export function planCommit(
  results: RowResult[],
  ctx: CommitContext,
): { batches: CommitBatch[]; customerIds: string[] } {
  // Group rows per customer, keeping file order.
  const groups = new Map<string, { match: string | null; rows: { n: number; rec: NormalizedRecord }[] }>();
  for (const r of committableRows(results)) {
    const rec = r.normalized!;
    const key = r.matchCustomerId ? `id:${r.matchCustomerId}` : rec.customerKey;
    const group = groups.get(key) ?? { match: r.matchCustomerId, rows: [] };
    group.rows.push({ n: r.rowNumber, rec });
    groups.set(key, group);
  }

  const existingVehicles = new Map<string, { id: string; plateNorm: string | null; vin: string | null }[]>();
  for (const v of ctx.existing.vehicles)
    existingVehicles.set(v.customerId, [...(existingVehicles.get(v.customerId) ?? []), v]);

  const batches: CommitBatch[] = [];
  const customerIds: string[] = [];
  let current: CommitBatch = { rowNumbers: [], customers: [], vehicles: [], visits: [] };

  for (const [key, group] of groups) {
    const customerId = group.match ?? ctx.idFor(`${ctx.importId}:customer:${key}`);
    customerIds.push(customerId);

    // Latest row wins for contact fields (job histories list visits oldest first).
    const ordered = [...group.rows].sort(
      (a, b) => (a.rec.visit?.visited_at ?? "").localeCompare(b.rec.visit?.visited_at ?? "") || a.n - b.n,
    );
    const pick = <K extends keyof NormalizedRecord["customer"]>(field: K) =>
      ordered.reduce<NormalizedRecord["customer"][K] | null>((acc, r) => r.rec.customer[field] ?? acc, null);
    const consent = ordered.some((r) => r.rec.customer.consent === true);
    const basis: LegalBasis = consent ? "consent" : (ctx.declaredBasis ?? "unknown");
    const phone = pick("phone_e164");
    current.customers.push({
      id: customerId,
      external_id: pick("external_id"),
      first_name: pick("first_name"),
      last_name: pick("last_name"),
      phone_e164: phone,
      phone_type: phone
        ? ordered.reduce((acc, r) => (r.rec.customer.phone_e164 ? r.rec.customer.phone_type : acc), "unknown")
        : "unknown",
      email: pick("email"),
      legal_basis: basis,
      legal_basis_source: basis === "unknown" ? null : `import:${ctx.importId}`,
      legal_basis_recorded_at: basis === "unknown" ? null : ctx.recordedAt,
      notes: pick("notes"),
    });

    // Vehicles: by VIN or plate within this customer; existing ones are reused.
    const known = existingVehicles.get(customerId) ?? [];
    const vehicleIds = new Map<string, string>();
    for (const { rec } of ordered) {
      const v = rec.vehicle;
      if (!v) continue;
      const vkey = v.vin ? `vin:${v.vin}` : v.plate_norm ? `plate:${v.plate_norm}` : `bm:${v.brand}|${v.model}`;
      if (vehicleIds.has(vkey)) continue;
      const existing = known.find((k) => (v.vin && k.vin === v.vin) || (v.plate_norm && k.plateNorm === v.plate_norm));
      const id = existing?.id ?? ctx.idFor(`${ctx.importId}:vehicle:${customerId}:${vkey}`);
      vehicleIds.set(vkey, id);
      current.vehicles.push({
        id,
        customer_id: customerId,
        brand: v.brand,
        model: v.model,
        model_year: null,
        license_plate_display: v.plate_display,
        license_plate_norm: v.plate_norm,
        vin: v.vin,
      });
    }

    for (const { rec } of ordered) {
      if (!rec.visit) continue;
      const v = rec.vehicle;
      const vkey = v
        ? v.vin
          ? `vin:${v.vin}`
          : v.plate_norm
            ? `plate:${v.plate_norm}`
            : `bm:${v.brand}|${v.model}`
        : "";
      current.visits.push({
        customer_id: customerId,
        vehicle_id: v ? (vehicleIds.get(vkey) ?? null) : null,
        visited_at: rec.visit.visited_at,
        service_type_raw: rec.visit.service_type_raw,
        service_category: categorizeService(rec.visit.service_type_raw, ctx.companyMappings),
        job_value_minor: rec.visit.job_value_minor,
        // Stable per customer key + vehicle + date + job: re-imports update, never duplicate.
        external_ref: `imp:${ctx.hash([rec.customerKey, vkey, rec.visit.visited_at, rec.visit.service_type_raw ?? "", rec.visit.job_value_minor ?? ""].join("|"))}`,
      });
    }

    current.rowNumbers.push(...group.rows.map((r) => r.n));
    if (current.rowNumbers.length >= COMMIT_BATCH_ROWS) {
      batches.push(current);
      current = { rowNumbers: [], customers: [], vehicles: [], visits: [] };
    }
  }
  if (current.rowNumbers.length) batches.push(current);
  return { batches, customerIds };
}
