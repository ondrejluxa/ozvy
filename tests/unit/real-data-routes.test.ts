import { describe, expect, it } from "vitest";
import { isRealDataReady, isUuid } from "@/lib/real-data-routes";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("isRealDataReady", () => {
  it("allows the screens that read real data", () => {
    for (const path of [
      "/admin",
      "/admin/companies",
      "/admin/companies/new",
      `/admin/companies/${ID}/settings`,
      `/admin/companies/${ID}/dpa`,
      `/admin/companies/${ID}/services`,
      `/admin/companies/${ID}/segments`,
      `/admin/companies/${ID}/campaigns`,
      `/admin/companies/${ID}/campaigns/new`,
      `/admin/companies/${ID}/campaigns/${ID}`,
      `/admin/companies/${ID}/campaigns/${ID}/edit`,
      `/app/campaigns/${ID}`,
      `/admin/companies/${ID}`,
      `/admin/companies/${ID}/customers`,
      `/admin/companies/${ID.toUpperCase()}/`,
      "/app",
      "/app/customers",
      `/app/customers/${ID}`,
      `/admin/companies/${ID}/customers/${ID}`,
      `/admin/companies/${ID}/vocatives`,
      "/admin/system",
      "/app/results",
    ]) {
      expect(isRealDataReady(path), path).toBe(true);
    }
  });

  it("keeps demo-store screens behind 'Tato část se připravuje'", () => {
    for (const path of [
      "/admin/campaigns",

      "/admin/companies/not-a-uuid",
      "/admin/companies/new/settings",
      "/app/resultsx",
      `/admin/companies/${ID}/campaigns/${ID}/recipients`,

      "/app/customersx",
      `/app/customers/${ID}/edit`,
    ]) {
      expect(isRealDataReady(path), path).toBe(false);
    }
  });

  it("recognises UUIDs", () => {
    expect(isUuid(ID)).toBe(true);
    expect(isUuid(`${ID}x`)).toBe(false);
    expect(isUuid("1; drop table")).toBe(false);
  });
});
