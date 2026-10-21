import { describe, expect, it } from "vitest";
import { FIRST_NAMES_FEMALE, SURNAMES } from "@/lib/db/demo/fixtures";
import { monthsBetween, fromDateOnly } from "@/lib/domain/dates";
import { normalizeServiceLabel } from "@/lib/domain/service-labels";
import { buildSeedWorld } from "@/supabase/seed/rows";

/** The Supabase seed world (spec §31): sizes, distributions, determinism and tenant integrity. */

const NOW = new Date("2026-10-21T10:00:00Z");
const world = buildSeedWorld(NOW);
const [dvorak, horak, nadrazi] = world.companies;
const of = <T extends { company_id: string }>(rows: T[], companyId: string) =>
  rows.filter((r) => r.company_id === companyId);
const share = (part: number, whole: number) => part / whole;

describe("seed world", () => {
  it("has the three shops of spec §31 with their sizes", () => {
    expect(world.companies.map((c) => [c.name, c.city])).toEqual([
      ["Autoservis Dvořák s.r.o.", "Kolín"],
      ["Pneu & Servis Horák", "Brno"],
      ["Garáž U Nádraží", "Jihlava"],
    ]);
    expect(of(world.customers, dvorak.id)).toHaveLength(1_800);
    expect(of(world.vehicles, dvorak.id)).toHaveLength(2_300);
    expect(of(world.customers, horak.id)).toHaveLength(3_200);
    expect(of(world.customers, nadrazi.id)).toHaveLength(600);
    expect(world.companies.every((c) => c.service_mode === "managed")).toBe(true);
  });

  it("is deterministic: the same IDs and people whatever the seeding date", () => {
    const later = buildSeedWorld(new Date("2027-03-02T08:30:00Z"));
    expect(later.companies.map((c) => c.id)).toEqual(world.companies.map((c) => c.id));
    const pick = (w: typeof world) => w.customers.map((c) => [c.id, c.first_name, c.last_name, c.phone_e164]);
    expect(pick(later)).toEqual(pick(world));
    expect(later.vehicles.map((v) => v.license_plate_display)).toEqual(
      world.vehicles.map((v) => v.license_plate_display),
    );
  });

  it("follows the contact distributions", () => {
    const n = world.customers.length;
    expect(world.customers.every((c) => !c.phone_e164 || /^\+420\d{9}$/.test(c.phone_e164))).toBe(true);
    const emails = world.customers.flatMap((c) => (c.email ? [c.email] : []));
    expect(emails.every((e) => /@example\.(cz|com)$/.test(e))).toBe(true);
    const unknown = share(world.customers.filter((c) => c.legal_basis === "unknown").length, n);
    expect(unknown).toBeGreaterThan(0.03);
    expect(unknown).toBeLessThan(0.07);
    const mobile = (id: string) => {
      const rows = of(world.customers, id).filter((c) => c.phone_e164);
      return share(rows.filter((c) => c.phone_type === "mobile").length, rows.length);
    };
    expect(mobile(dvorak.id)).toBeGreaterThan(0.85);
    expect(mobile(horak.id)).toBeLessThan(0.8); // tyre shop with many fixed lines (warnings)
  });

  it("uses correct female surname forms", () => {
    const female = new Set(FIRST_NAMES_FEMALE);
    const femaleSurnames = new Set(SURNAMES.map(([, f]) => f));
    const women = world.customers.filter((c) => female.has(c.first_name!));
    expect(women.length).toBeGreaterThan(world.customers.length * 0.4);
    expect(women.every((c) => femaleSurnames.has(c.last_name!))).toBe(true);
  });

  it("generates Czech plates, structured VINs and the brand mix", () => {
    expect(world.vehicles.every((v) => /^\d[A-Z][\dA-Z] \d{4}$/.test(v.license_plate_display!))).toBe(true);
    expect(world.vehicles.every((v) => v.license_plate_norm === v.license_plate_display!.replace(" ", ""))).toBe(true);
    const vins = world.vehicles.flatMap((v) => (v.vin ? [v.vin] : []));
    expect(share(vins.length, world.vehicles.length)).toBeGreaterThan(0.55);
    expect(share(vins.length, world.vehicles.length)).toBeLessThan(0.65);
    expect(vins.every((v) => /^[A-HJ-NPR-Z0-9]{17}$/.test(v))).toBe(true);
    const skoda = share(world.vehicles.filter((v) => v.brand === "Škoda").length, world.vehicles.length);
    expect(skoda).toBeGreaterThan(0.31);
    expect(skoda).toBeLessThan(0.39);
  });

  it("gives Garáž U Nádraží sparse data: no job values, ~30 % customers without a vehicle", () => {
    expect(of(world.visits, nadrazi.id).every((v) => v.job_value_minor === null)).toBe(true);
    const withVehicle = new Set(of(world.vehicles, nadrazi.id).map((v) => v.customer_id));
    const without = share(600 - withVehicle.size, 600);
    expect(without).toBeGreaterThan(0.25);
    expect(without).toBeLessThan(0.35);
    expect(of(world.visits, dvorak.id).every((v) => (v.job_value_minor ?? 0) > 0)).toBe(true);
  });

  it("has about a quarter of vehicles churned (no visit for 14+ months)", () => {
    const vehicles = world.vehicles.filter((v) => v.company_id !== nadrazi.id);
    const churned = vehicles.filter((v) => monthsBetween(fromDateOnly(v.last_visit_at!), NOW) > 14).length;
    expect(share(churned, vehicles.length)).toBeGreaterThan(0.2);
    expect(share(churned, vehicles.length)).toBeLessThan(0.35);
  });

  it("never links rows across tenants", () => {
    const customers = new Map(world.customers.map((c) => [c.id, c]));
    const vehicles = new Map(world.vehicles.map((v) => [v.id, v]));
    for (const v of world.vehicles) expect(customers.get(v.customer_id!)?.company_id).toBe(v.company_id);
    for (const visit of world.visits) {
      expect(customers.get(visit.customer_id!)?.company_id).toBe(visit.company_id);
      if (visit.vehicle_id) {
        const vehicle = vehicles.get(visit.vehicle_id)!;
        expect(vehicle.company_id).toBe(visit.company_id);
        expect(vehicle.customer_id).toBe(visit.customer_id);
      }
    }
    const ids = [...world.customers, ...world.vehicles, ...world.visits].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("stores lifecycle columns consistent with the visits", () => {
    const byCustomer = new Map<string, { last: string; count: number; value: number }>();
    for (const v of world.visits) {
      const agg = byCustomer.get(v.customer_id!) ?? { last: "", count: 0, value: 0 };
      byCustomer.set(v.customer_id!, {
        last: agg.last < v.visited_at ? v.visited_at : agg.last,
        count: agg.count + 1,
        value: agg.value + (v.job_value_minor ?? 0),
      });
    }
    for (const c of world.customers) {
      const agg = byCustomer.get(c.id)!;
      expect([c.last_visit_at, c.visit_count, c.lifetime_value_minor]).toEqual([agg.last, agg.count, agg.value]);
      expect(["active", "at_risk", "inactive"]).toContain(c.lifecycle_status);
    }
    const statuses = new Set(world.customers.map((c) => c.lifecycle_status));
    expect(statuses).toEqual(new Set(["active", "at_risk", "inactive"]));
  });

  it("maps every raw service label once per company", () => {
    for (const company of world.companies) {
      const rows = world.serviceCategoryMappings.filter((m) => m.company_id === company.id);
      expect(new Set(rows.map((m) => m.raw_value_norm)).size).toBe(rows.length);
      expect(new Set(rows.map((m) => m.category)).size).toBe(9);
    }
    const labels = new Set(world.serviceCategoryMappings.map((m) => m.raw_value_norm));
    for (const v of world.visits.slice(0, 500))
      expect(labels.has(normalizeServiceLabel(v.service_type_raw!))).toBe(true);
  });

  it("seeds one operator and an owner and a manager per shop", () => {
    expect(world.accounts.filter((a) => a.platformAdmin)).toHaveLength(1);
    for (let i = 0; i < world.companies.length; i++) {
      const roles = world.accounts.filter((a) => a.company === i).map((a) => a.role);
      expect(roles.sort()).toEqual(["shop_manager", "shop_owner"]);
    }
    expect(world.accounts.every((a) => a.email.endsWith(".example.cz"))).toBe(true);
    expect(new Set(world.accounts.map((a) => a.email)).size).toBe(world.accounts.length);
  });
});

describe("normalizeServiceLabel", () => {
  it("lower-cases, strips diacritics and collapses spaces", () => {
    expect(normalizeServiceLabel("  Přezutí   KOL ")).toBe("prezuti kol");
    expect(normalizeServiceLabel("SERVIS + olej")).toBe("servis + olej");
    expect(normalizeServiceLabel("Klima\u00a0-\tdezinfekce")).toBe("klima - dezinfekce");
  });
});
