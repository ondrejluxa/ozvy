import { describe, expect, it } from "vitest";
import { auditDetails, auditQuery, auditRange, parseAuditFilter } from "@/lib/domain/audit-filters";

describe("audit log filters (spec §23)", () => {
  it("reads group, dates and page from the URL and ignores anything invalid", () => {
    expect(parseAuditFilter({ akce: "campaign", od: "2026-11-01", do: "2026-11-13", strana: "3" })).toEqual({
      group: "campaign",
      from: "2026-11-01",
      to: "2026-11-13",
      page: 3,
    });
    expect(parseAuditFilter({ akce: "drop table", od: "2026-02-30", do: "13.11.2026", strana: "-1" })).toEqual({
      group: null,
      from: null,
      to: null,
      page: 1,
    });
  });

  it("swaps a reversed range", () => {
    expect(parseAuditFilter({ od: "2026-11-13", do: "2026-11-01" })).toMatchObject({
      from: "2026-11-01",
      to: "2026-11-13",
    });
  });

  it("filters whole Prague days, including the last one", () => {
    const r = auditRange({ group: null, from: "2026-11-01", to: "2026-11-13", page: 1 });
    expect(r.gte).toBe("2026-10-31T23:00:00.000Z"); // 1 Nov 00:00 CET
    expect(r.lt).toBe("2026-11-13T23:00:00.000Z"); // 14 Nov 00:00 CET
    const summer = auditRange({ group: null, from: "2026-07-01", to: null, page: 1 });
    expect(summer).toEqual({ gte: "2026-06-30T22:00:00.000Z", lt: null }); // CEST
  });

  it("keeps the filter when paging", () => {
    const f = { group: "dsr" as const, from: "2026-11-01", to: null, page: 1 };
    expect(auditQuery(f, 2)).toBe("?akce=dsr&od=2026-11-01&strana=2");
    expect(auditQuery({ group: null, from: null, to: null, page: 1 }, 1)).toBe("");
  });

  it("shows metadata compactly and skips empty values", () => {
    expect(auditDetails({ type: "erasure", customers: 1, fields: ["phone", "email"], note: null })).toBe(
      "type: erasure · customers: 1 · fields: phone, email",
    );
    expect(auditDetails({ long: "x".repeat(80) })).toBe(`long: ${"x".repeat(57)}…`);
    expect(auditDetails(null)).toBe("");
  });
});
