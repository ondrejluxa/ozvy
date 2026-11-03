import { describe, expect, it, vi } from "vitest";
import { NIGHTLY_STATUSES, recomputeAllCompanies } from "@/lib/jobs/lifecycle-core";
import { normalizeServiceLabel, SERVICE_CATEGORIES } from "@/lib/domain/service-labels";

/** A minimal stand-in for the Supabase client: companies query + recompute RPC. */
function fakeClient(companies: string[], failing: Set<string>) {
  const rpc = vi.fn(async (_name: string, args: { p_company_id: string }) =>
    failing.has(args.p_company_id) ? { data: null, error: { code: "57014" } } : { data: 10, error: null },
  );
  const order = vi.fn(async () => ({ data: companies.map((id) => ({ id })), error: null }));
  const inFilter = vi.fn(() => ({ order }));
  const client = { from: () => ({ select: () => ({ in: inFilter }) }), rpc };
  return { client: client as never, rpc, inFilter };
}

describe("nightly lifecycle job", () => {
  it("recomputes every open company and keeps going when one fails", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { client, rpc, inFilter } = fakeClient(["a", "b", "c"], new Set(["b"]));
    const result = await recomputeAllCompanies(client);
    expect(result).toEqual({ companies: 2, customers: 20, failed: ["b"] });
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(inFilter).toHaveBeenCalledWith("status", [...NIGHTLY_STATUSES]);
    expect(NIGHTLY_STATUSES).not.toContain("closed");
    // Logs carry the company ID only (spec §22).
    expect(errors.mock.calls.flat().join(" ")).not.toMatch(/@|\+420/);
    errors.mockRestore();
  });
});

describe("service labels", () => {
  it("normalise exactly like app.normalize_service_label (asserted in 07_lifecycle.test.sql)", () => {
    expect(normalizeServiceLabel("  Přezutí   KOL + Uskladnění ")).toBe("prezuti kol + uskladneni");
    expect(normalizeServiceLabel("Klima - dezinfekce")).toBe("klima - dezinfekce");
    expect(normalizeServiceLabel("GEOMETRIE ")).toBe("geometrie");
  });

  it("list the nine canonical categories", () => {
    expect(SERVICE_CATEGORIES).toHaveLength(9);
    expect(SERVICE_CATEGORIES.at(-1)).toBe("repair_other");
  });
});
