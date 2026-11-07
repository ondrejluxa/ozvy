import { describe, expect, it } from "vitest";
import { campaignsCount, digestHtml, digestSubject, digestText, type DigestInput } from "@/lib/domain/alerts/digest";
import { evaluateAlerts, healthFromAlerts, isImportStuck } from "@/lib/domain/alerts/rules";
import { parseCompanyProfile } from "@/lib/domain/company-profile";

const NOW = new Date("2026-11-05T05:00:00Z");

describe("import needs review (spec §10)", () => {
  const base = {
    companyId: "c1",
    companyStatus: "onboarding",
    companyCreatedAt: NOW,
    campaigns: [],
    lastSendAt: null,
    recentDeliveryRate: null,
    roiPreviousMonths: [null, null] as [null, null],
    topOpportunity: null,
    now: NOW,
  };

  it("raises one high alert per import waiting for review or with > 10 % invalid rows", () => {
    const alerts = evaluateAlerts({
      ...base,
      imports: [
        { id: "i1", status: "needs_review", updatedAt: NOW, rows: 100, invalid: 0 },
        { id: "i2", status: "completed", updatedAt: NOW, rows: 100, invalid: 11 },
        { id: "i3", status: "completed", updatedAt: NOW, rows: 100, invalid: 10 },
        { id: "i4", status: "completed", updatedAt: NOW, rows: 0, invalid: 0 },
      ],
    });
    expect(alerts.map((a) => a.key)).toEqual(["import_needs_review:i1", "import_needs_review:i2"]);
    expect(alerts.every((a) => a.severity === "high" && a.type === "import_needs_review")).toBe(true);
    expect(alerts[1].params).toMatchObject({ importId: "i2", rate: 0.11 });
    expect(healthFromAlerts(alerts)).toBe("red");
  });

  it("stays quiet without imports (the demo passes none)", () => {
    expect(evaluateAlerts(base)).toEqual([]);
  });

  it("tells the import page when to offer a way out", () => {
    const ago = (m: number) => new Date(NOW.getTime() - m * 60_000);
    expect(isImportStuck("validating", ago(31), NOW)).toBe(true);
    expect(isImportStuck("validating", ago(29), NOW)).toBe(false);
    expect(isImportStuck("mapping", ago(600), NOW)).toBe(false);
  });

  it("flags an import stuck in processing for more than 30 minutes, not one still moving", () => {
    const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
    const alerts = evaluateAlerts({
      ...base,
      imports: [
        { id: "parse", status: "parsing", updatedAt: minutesAgo(31), rows: 0, invalid: 0 },
        { id: "validate", status: "validating", updatedAt: minutesAgo(45), rows: 100, invalid: 50 },
        { id: "commit", status: "committing", updatedAt: minutesAgo(90), rows: 100, invalid: 0 },
        { id: "fresh", status: "validating", updatedAt: minutesAgo(29), rows: 100, invalid: 50 },
        { id: "waiting", status: "mapping", updatedAt: minutesAgo(600), rows: 100, invalid: 0 },
      ],
    });
    expect(alerts.map((a) => a.key)).toEqual(["import_stuck:parse", "import_stuck:validate", "import_stuck:commit"]);
    expect(alerts[1]).toMatchObject({ type: "import_stuck", severity: "high", params: { minutes: 45 } });
    // Partial counts of an import still in progress never raise "needs review".
    expect(alerts.some((a) => a.type === "import_needs_review")).toBe(false);
  });
});

describe("data subject requests (spec §21)", () => {
  const base = {
    companyId: "c1",
    companyStatus: "active",
    companyCreatedAt: NOW,
    campaigns: [],
    lastSendAt: null,
    recentDeliveryRate: null,
    roiPreviousMonths: [null, null] as [null, null],
    topOpportunity: null,
    now: NOW,
  };
  const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

  it("warns the operator from day 20 of the 30-day deadline", () => {
    const alerts = evaluateAlerts({
      ...base,
      dataSubjectRequests: [
        { id: "r19", type: "access", createdAt: daysAgo(19), dueAt: "2026-12-16" },
        { id: "r20", type: "erasure", createdAt: daysAgo(20), dueAt: "2026-12-15" },
        { id: "r31", type: "access", createdAt: daysAgo(31), dueAt: "2026-12-04" },
      ],
    });
    expect(alerts.map((a) => a.key)).toEqual(["dsr_due:r20", "dsr_due:r31"]);
    expect(alerts[0]).toMatchObject({
      type: "dsr_due",
      severity: "high",
      params: { requestId: "r20", requestType: "erasure", dueAt: "2026-12-15" },
    });
    expect(alerts[0].createdAt).toEqual(NOW);
  });
});

describe("operator digest (spec §25)", () => {
  const input: DigestInput = {
    openAlerts: 0,
    opened24h: [],
    resolved24h: 2,
    sent24h: 412,
    failed24h: 3,
    campaignsToday: [
      { company: "Autoservis Dvořák s.r.o.", name: "Zimní servis", at: "9:00" },
      { company: "Pneu & Servis Horák", name: "Přezutí", at: "10:30" },
      { company: "Garáž U Nádraží", name: "STK", at: "11:00" },
    ],
    titles: { campaign_failed: "Kampaň selhala" },
    appUrl: "https://app.example.cz",
  };

  it("says so in the subject when all is well", () => {
    expect(digestSubject(input)).toBe("Vše v pořádku · 3 kampaně dnes");
    expect(digestSubject({ ...input, openAlerts: 2, campaignsToday: [] })).toBe(
      "Vyžaduje pozornost: 2 upozornění · 0 kampaní dnes",
    );
  });

  it("declines campaigns in Czech", () => {
    expect([0, 1, 2, 4, 5, 11].map(campaignsCount)).toEqual([
      "0 kampaní",
      "1 kampaň",
      "2 kampaně",
      "4 kampaně",
      "5 kampaní",
      "11 kampaní",
    ]);
  });

  it("lists the last 24 hours and today's campaigns, escaped in HTML", () => {
    const text = digestText({
      ...input,
      openAlerts: 1,
      opened24h: [{ company: "Garáž <U Nádraží>", type: "campaign_failed" }],
    });
    expect(text).toContain("odesláno 412 SMS, nedoručeno nebo selhalo 3");
    expect(text).toContain("Nová upozornění: 1, vyřešená: 2, otevřená celkem: 1.");
    expect(text).toContain("- Garáž <U Nádraží>: Kampaň selhala");
    expect(text).toContain("- 9:00 · Autoservis Dvořák s.r.o. · Zimní servis");
    expect(text).toContain("https://app.example.cz/admin");
    expect(digestText({ ...input, campaignsToday: [] })).toContain("Na dnešek není naplánovaná žádná kampaň.");
    const html = digestHtml({ ...input, opened24h: [{ company: "Garáž <U Nádraží>", type: "x" }] });
    expect(html).toContain("Garáž &lt;U Nádraží&gt;");
    expect(html).not.toContain("<U Nádraží>");
  });
});

describe("subscription price on the company profile", () => {
  const VALID = {
    name: "Autoservis Test",
    ico: "28451325",
    dic: "",
    address_line: "",
    city: "",
    postal_code: "",
    contact_person: "",
    phone: "",
    email: "",
    website: "",
    average_job_value_czk: "4 200",
    default_sender_name: "",
    opening_hours: "",
    requires_client_approval: false,
    status: "active",
  };

  it("is optional (0) and stored in haléře", () => {
    const empty = parseCompanyProfile(VALID);
    expect(empty.success && empty.values.subscription_price_minor).toBe(0);
    const set = parseCompanyProfile({ ...VALID, subscription_czk: "4 990" });
    expect(set.success && set.values.subscription_price_minor).toBe(499_000);
  });

  it("rejects fractions, negatives and implausible prices", () => {
    for (const bad of ["4990,50", "-1", "200000", "abc"]) {
      const r = parseCompanyProfile({ ...VALID, subscription_czk: bad });
      expect(r.success ? null : r.fieldErrors.subscription_czk).toBe("invalid_subscription");
    }
  });
});
