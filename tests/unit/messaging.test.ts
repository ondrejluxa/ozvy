import { describe, expect, it } from "vitest";
import { validateTemplate } from "@/lib/ai/validate";
import { TEMPLATE_LIBRARY } from "@/lib/ai/templates-library";
import { stripDiacritics } from "@/lib/domain/messaging/diacritics";
import { formatNationalPhone, renderTemplate, vehiclePhrase } from "@/lib/domain/messaging/render";
import { isCzechHoliday, isWithinSendingWindow, nextSendingSlot } from "@/lib/domain/messaging/sending-window";
import { countSmsSegments } from "@/lib/domain/messaging/sms-segments";
import { pragueParts, pragueTime } from "@/lib/domain/dates";

const NOW = new Date("2026-10-05T10:00:00Z");
const shop = { shopName: "Autoservis Dvořák", phone: "+420321724118" };
const recipient = {
  firstName: "Jana",
  lastName: "Procházková",
  vehicleBrand: "Škoda",
  vehicleModel: "Octavia",
  lastVisitAt: "2025-09-12",
};

describe("countSmsSegments", () => {
  it("counts GSM-7 single and multipart messages", () => {
    expect(countSmsSegments("a".repeat(160))).toMatchObject({ encoding: "GSM-7", segments: 1 });
    expect(countSmsSegments("a".repeat(161))).toMatchObject({ encoding: "GSM-7", segments: 2 });
    expect(countSmsSegments("a".repeat(306))).toMatchObject({ segments: 2 });
    expect(countSmsSegments("a".repeat(307))).toMatchObject({ segments: 3 });
  });

  it("counts GSM-7 extension characters twice", () => {
    expect(countSmsSegments("€".repeat(80)).units).toBe(160);
    expect(countSmsSegments("€".repeat(81)).segments).toBe(2);
  });

  it("switches to UCS-2 on one Czech diacritic", () => {
    const info = countSmsSegments(`${"a".repeat(69)}ř`);
    expect(info).toMatchObject({ encoding: "UCS-2", segments: 1, units: 70 });
    expect(countSmsSegments(`${"a".repeat(70)}ř`).segments).toBe(2);
    expect(countSmsSegments("ř".repeat(134)).segments).toBe(2);
    expect(countSmsSegments("ř".repeat(135)).segments).toBe(3);
  });

  it("stripping diacritics returns a GSM-7 message", () => {
    const text = "Dobrý den, přezutí čeká – „rádi“ vás uvidíme…";
    expect(countSmsSegments(stripDiacritics(text)).encoding).toBe("GSM-7");
    expect(stripDiacritics("Škoda Řepa ůž")).toBe("Skoda Repa uz");
    // Digits and letters survive; a non-breaking space becomes a plain one.
    expect(stripDiacritics("tel. 321 724 118, 0 a")).toBe("tel. 321 724 118, 0 a");
  });
});

describe("renderTemplate", () => {
  const template = TEMPLATE_LIBRARY.no_visit_12m.friendly;

  it("fills placeholders with Czech forms", () => {
    const r = renderTemplate(template, { recipient, shop, optOutUrl: "example.cz/o/abc", now: NOW });
    expect(r.text).toContain("Dobrý den, dlouho jsme se neviděli");
    expect(r.text).toContain("vaši Škodu Octavia");
    expect(r.text).toContain("loni v září");
    expect(r.text).toContain("tel. 321 724 118");
    expect(r.text).toMatch(/Odhlásit: example\.cz\/o\/abc$/);
    expect(r.missingRequired).toEqual([]);
    expect(r.fallbacks).toEqual([]);
  });

  it("uses fallbacks and drops the sentence with a missing last visit", () => {
    const r = renderTemplate(template, {
      recipient: { ...recipient, vehicleBrand: null, vehicleModel: null, lastVisitAt: null },
      shop,
      optOutUrl: "example.cz/o/abc",
      now: NOW,
    });
    expect(r.text).toContain("postaráme o vaše auto");
    expect(r.text).not.toContain("Naposledy jste u nás byli");
    expect(r.fallbacks).toEqual(expect.arrayContaining(["vozidlo", "posledni_navsteva"]));
  });

  it("refuses a template without opt-out", () => {
    const r = renderTemplate("{{osloveni}} přijeďte. {{servis}}", { recipient, shop, optOutUrl: "x", now: NOW });
    expect(r.missingRequired).toEqual(["odhlaseni"]);
  });

  it("produces accusative vehicle phrases", () => {
    expect(vehiclePhrase("Škoda", "Fabia")).toBe("vaši Škodu Fabia");
    expect(vehiclePhrase("Ford", "Focus")).toBe("váš Ford Focus");
    expect(vehiclePhrase("BMW", "X3")).toBe("vaše BMW X3");
    expect(vehiclePhrase(null, null)).toBeNull();
    expect(formatNationalPhone("+420777123456")).toBe("777 123 456");
  });
});

describe("template library and validator", () => {
  it("every library template passes validation", () => {
    for (const tones of Object.values(TEMPLATE_LIBRARY)) {
      for (const template of Object.values(tones)) {
        expect(validateTemplate(template, { now: NOW })).toEqual([]);
      }
    }
  });

  it("flags risky wording, prices and links", () => {
    const codes = validateTemplate("Dobrý den, vaše auto nutně potřebuje servis za 990 Kč, www.x.cz", { now: NOW }).map(
      (i) => i.code,
    );
    expect(codes).toEqual(
      expect.arrayContaining(["missing_greeting", "missing_required", "denylist", "price_not_in_offer", "url"]),
    );
  });
});

describe("sending window", () => {
  it("allows weekdays 9–18 and Saturday 9–12 only", () => {
    expect(isWithinSendingWindow(pragueTime(2026, 10, 6, 10))).toBe(true); // Tue
    expect(isWithinSendingWindow(pragueTime(2026, 10, 6, 18, 30))).toBe(false);
    expect(isWithinSendingWindow(pragueTime(2026, 10, 10, 11))).toBe(true); // Sat
    expect(isWithinSendingWindow(pragueTime(2026, 10, 10, 14))).toBe(false);
    expect(isWithinSendingWindow(pragueTime(2026, 10, 11, 10))).toBe(false); // Sun
  });

  it("knows Czech public holidays including Easter", () => {
    expect(isCzechHoliday(pragueTime(2026, 10, 28, 12))).toBe(true);
    expect(isCzechHoliday(pragueTime(2026, 4, 3, 12))).toBe(true); // Good Friday 2026
    expect(isCzechHoliday(pragueTime(2026, 4, 6, 12))).toBe(true); // Easter Monday 2026
    expect(isCzechHoliday(pragueTime(2026, 4, 7, 12))).toBe(false);
  });

  it("moves Saturday afternoon to Monday 9:00 and skips 28 October", () => {
    const fromSaturday = pragueParts(nextSendingSlot(pragueTime(2026, 10, 10, 14)));
    expect(fromSaturday).toMatchObject({ month: 10, day: 12, hour: 9, minute: 0 });
    const fromHoliday = pragueParts(nextSendingSlot(pragueTime(2026, 10, 28, 8)));
    expect(fromHoliday).toMatchObject({ month: 10, day: 29, hour: 9 });
  });
});
