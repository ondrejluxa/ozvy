import { describe, expect, it } from "vitest";
import {
  buildCustomerExport,
  canOwnerRequest,
  dsrDaysLeft,
  dsrDueDate,
  exportFileName,
  type ExportSource,
} from "@/lib/domain/privacy";

const NOW = new Date("2026-11-13T09:00:00Z");

describe("data subject request deadlines (spec §21)", () => {
  it("is due 30 Prague calendar days after it was filed", () => {
    expect(dsrDueDate(NOW)).toBe("2026-12-13");
    // 23:30 UTC on 13 Nov is already 14 Nov in Prague.
    expect(dsrDueDate(new Date("2026-11-13T23:30:00Z"))).toBe("2026-12-14");
  });

  it("counts the days left, negative when overdue", () => {
    expect(dsrDaysLeft("2026-12-13", NOW)).toBe(30);
    expect(dsrDaysLeft("2026-11-13", NOW)).toBe(0);
    expect(dsrDaysLeft("2026-11-10", NOW)).toBe(-3);
  });

  it("lets a managed shop owner file only access and erasure requests", () => {
    expect(canOwnerRequest("access")).toBe(true);
    expect(canOwnerRequest("erasure")).toBe(true);
    expect(canOwnerRequest("rectification")).toBe(false);
    expect(canOwnerRequest("objection")).toBe(false);
    expect(canOwnerRequest("anything")).toBe(false);
  });
});

describe("customer data export (spec §21 access request)", () => {
  const source: ExportSource = {
    company: { name: "Autoservis Dvořák s.r.o." },
    customer: {
      id: "5d3f2a8e-0000-4000-8000-000000000001",
      firstName: "Jana",
      lastName: "Nováková",
      phone: "+420777000001",
      email: "jana@example.cz",
      notes: null,
      legalBasis: "existing_customer",
      legalBasisSource: "import:abc",
      lifecycleStatus: "inactive",
      lastVisitAt: "2025-03-01",
      createdAt: "2026-10-01T08:00:00Z",
    },
    vehicles: [{ brand: "Škoda", model: "Octavia", plate: "1AB 2345", year: 2016 }],
    visits: [
      { visitedAt: "2024-03-01", service: "regular_service", jobValueMinor: 450000 },
      { visitedAt: "2025-03-01", service: "tyre_change", jobValueMinor: 120000 },
    ],
    messages: [
      { sentAt: "2026-10-02T09:00:00Z", status: "delivered", body: "Dobrý den…", optedOutAt: null },
      { sentAt: "2026-10-09T09:00:00Z", status: "delivered", body: "Připomínáme…", optedOutAt: null },
    ],
    conversions: [{ stage: "completed", bookedAt: null, completedAt: "2026-10-20T10:00:00Z", revenueMinor: 450000 }],
    suppressed: true,
  };

  it("contains the person's complete data, newest first, and no internal IDs", () => {
    const out = buildCustomerExport(source, NOW);
    expect(out).toMatchObject({
      format: "navrat.customer-export.v1",
      exportedAt: NOW.toISOString(),
      controller: "Autoservis Dvořák s.r.o.",
      subject: { firstName: "Jana", phone: "+420777000001", email: "jana@example.cz", lastVisit: "2025-03-01" },
      marketingObjection: true,
    });
    expect(out.visits.map((v) => v.visitedAt)).toEqual(["2025-03-01", "2024-03-01"]);
    expect(out.messages[0].body).toBe("Připomínáme…");
    expect(out.bookingsAndJobs).toHaveLength(1);
    expect(JSON.stringify(out)).not.toContain(source.customer.id);
  });

  it("names the file without personal data", () => {
    const name = exportFileName(source.customer.id, NOW);
    expect(name).toBe("export-zakaznika-5d3f2a8e-2026-11-13.json");
    expect(name).not.toMatch(/Jana|Nováková|777/);
  });
});
