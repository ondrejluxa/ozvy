import { describe, expect, it } from "vitest";
import { renderTemplate } from "@/lib/domain/messaging/render";
import {
  DEFAULT_GREETING,
  greetingFor,
  isVocativeApproved,
  normalizeSurname,
  plausibleVocative,
  REVIEW_THRESHOLD,
  ruleVocative,
} from "@/lib/domain/messaging/vocative";

describe("ruleVocative", () => {
  it.each([
    // spec §15 examples
    ["Novák", "Nováku", "m"],
    ["Dvořák", "Dvořáku", "m"],
    ["Svoboda", "Svobodo", "m"],
    ["Černý", "Černý", "m"],
    ["Nováková", "Nováková", "f"],
    // common patterns
    ["Procházka", "Procházko", "m"],
    ["Hájek", "Hájku", "m"],
    ["Sedláček", "Sedláčku", "m"],
    ["Beneš", "Beneši", "m"],
    ["Kovář", "Kováři", "m"],
    ["Kříž", "Kříži", "m"],
    ["Zeman", "Zemane", "m"],
    ["Musil", "Musile", "m"],
    ["Holub", "Holube", "m"],
    ["Navrátil", "Navrátile", "m"],
    ["Mach", "Machu", "m"],
    ["Kocour", "Kocoure", "m"],
    ["Černá", "Černá", "f"],
    ["NOVÁK", "Nováku", "m"],
  ])("%s → %s (%s), confident", (surname, vocative, gender) => {
    const g = ruleVocative(surname)!;
    expect(g).toMatchObject({ vocative, gender });
    expect(g.confidence).toBeGreaterThanOrEqual(REVIEW_THRESHOLD);
  });

  it.each([
    ["Krejčí", "unknown"],
    ["Němec", "m"],
    ["Havel", "m"],
    ["Kubr", "m"],
  ])("%s is suggested but needs review", (surname, gender) => {
    const g = ruleVocative(surname)!;
    expect(g.gender).toBe(gender);
    expect(g.confidence).toBeLessThan(REVIEW_THRESHOLD);
  });

  it.each(["Klaus", "Matějů", "Nový-Malý", "O'Neill", "Li", "X", "123", ""])("%s has no rule", (surname) => {
    expect(ruleVocative(surname)).toBeNull();
  });
});

describe("normalizeSurname", () => {
  it("title-cases all-caps imports and keeps mixed case", () => {
    expect(normalizeSurname("  NOVÁKOVÁ ")).toBe("Nováková");
    expect(normalizeSurname("NOVÝ-MALÝ")).toBe("Nový-Malý");
    expect(normalizeSurname("McDonald")).toBe("McDonald");
    expect(normalizeSurname("novák")).toBe("novák");
  });
});

describe("greetings", () => {
  const approved = { vocative: "Nováku", gender: "m" as const, confidence: 0.95, reviewedAt: null };

  it("uses only approved vocatives with a known gender", () => {
    expect(greetingFor(approved)).toBe("Dobrý den, pane Nováku,");
    expect(greetingFor({ ...approved, vocative: "Nováková", gender: "f" })).toBe("Dobrý den, paní Nováková,");
    expect(greetingFor({ ...approved, confidence: 0.6 })).toBe(DEFAULT_GREETING);
    expect(greetingFor({ ...approved, confidence: 0.6, reviewedAt: "2026-11-04T10:00:00Z" })).toBe(
      "Dobrý den, pane Nováku,",
    );
    expect(greetingFor({ ...approved, gender: "unknown", reviewedAt: "2026-11-04T10:00:00Z" })).toBe(DEFAULT_GREETING);
    expect(greetingFor(null)).toBe(DEFAULT_GREETING);
    expect(isVocativeApproved(approved)).toBe(true);
  });

  it("the renderer uses the greeting and falls back to Dobrý den", () => {
    const base = {
      shop: { shopName: "Autoservis Dvořák", phone: "+420321724118" },
      optOutUrl: "example.cz/o/abc",
      now: new Date("2026-11-04T10:00:00Z"),
    };
    const recipient = {
      firstName: "Jan",
      lastName: "Novák",
      vehicleBrand: null,
      vehicleModel: null,
      lastVisitAt: null,
    };
    const template = "{{osloveni}} přijeďte do {{servis}}. {{odhlaseni}}";
    expect(renderTemplate(template, { ...base, recipient }).text).toMatch(/^Dobrý den, přijeďte/);
    expect(
      renderTemplate(template, { ...base, recipient: { ...recipient, greeting: "Dobrý den, pane Nováku," } }).text,
    ).toMatch(/^Dobrý den, pane Nováku, přijeďte/);
  });
});

describe("plausibleVocative", () => {
  it("accepts endings on the same stem and rejects anything else", () => {
    expect(plausibleVocative("Klaus", "Klausi")).toBe(true);
    expect(plausibleVocative("Havel", "Havle")).toBe(true);
    expect(plausibleVocative("Matějů", "Matějů")).toBe(true);
    expect(plausibleVocative("Klaus", "Novák")).toBe(false);
    expect(plausibleVocative("Klaus", "Klausovicovi")).toBe(false);
    expect(plausibleVocative("Klaus", "Klaus <script>")).toBe(false);
    expect(plausibleVocative("Klaus", "")).toBe(false);
  });
});
