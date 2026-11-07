import { describe, expect, it } from "vitest";
import { SHOP_CONTACT_FIELDS, parseShopContact } from "@/lib/domain/company-profile";

const empty = Object.fromEntries(SHOP_CONTACT_FIELDS.map((f) => [f, ""])) as Record<
  (typeof SHOP_CONTACT_FIELDS)[number],
  string
>;

describe("the owner's contact details (Nastavení → Profil servisu)", () => {
  it("normalises phone and postal code and stores opening hours as a note", () => {
    const res = parseShopContact({
      ...empty,
      contact_person: " Jan Dvořák ",
      phone: "321 123 456",
      postal_code: "28002",
      city: "Kolín",
      opening_hours: "Po–Pá 7–17",
    });
    expect(res).toEqual({
      success: true,
      values: {
        contact_person: "Jan Dvořák",
        phone: "+420321123456",
        email: null,
        website: null,
        address_line: null,
        postal_code: "280 02",
        city: "Kolín",
        opening_hours: { note: "Po–Pá 7–17" },
      },
    });
  });

  it("rejects invalid values field by field", () => {
    const res = parseShopContact({ ...empty, phone: "12", email: "x@", website: "not a site" });
    expect(res).toEqual({
      success: false,
      fieldErrors: { phone: "invalid_phone", email: "invalid_email", website: "invalid_website" },
    });
  });

  it("never carries operator-controlled fields", () => {
    const res = parseShopContact({
      ...empty,
      ...({ default_sender_name: "CSOB", average_job_value_czk: "1", name: "Jiný" } as object),
    } as typeof empty);
    expect(res.success && Object.keys(res.values).sort()).toEqual([...SHOP_CONTACT_FIELDS].sort());
  });
});
