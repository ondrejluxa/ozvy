import { describe, expect, it } from "vitest";
import { czechPhoneType, parseCustomerContact, parseSearch } from "@/lib/domain/customer-search";

describe("parseSearch", () => {
  it("searches names without diacritics or case", () => {
    expect(parseSearch("  Dvořák ")).toEqual({ name: "dvorak", digits: null, plate: null });
    expect(parseSearch("Jana  Procházková")).toMatchObject({ name: "jana prochazkova" });
    expect(parseSearch("a").name).toBeNull();
  });

  it("treats digit strings as phone fragments", () => {
    expect(parseSearch("777 123 456")).toMatchObject({ name: null, digits: "777123456" });
    expect(parseSearch("+420 777")).toMatchObject({ digits: "420777" });
    expect(parseSearch("00420777123456")).toMatchObject({ digits: "420777123456" });
    expect(parseSearch("12").digits).toBeNull();
  });

  it("recognises plates with or without the space", () => {
    expect(parseSearch("2S4 7710")).toMatchObject({ plate: "2S47710", name: "2s4 7710" });
    expect(parseSearch("2s47710").plate).toBe("2S47710");
    expect(parseSearch("Novák").plate).toBeNull();
  });

  it("never passes LIKE wildcards or quotes through", () => {
    const t = parseSearch("50%_x'; drop");
    expect(Object.values(t).join("")).not.toMatch(/[%_';]/);
  });
});

describe("czechPhoneType", () => {
  it("follows the Czech numbering plan", () => {
    expect(czechPhoneType("+420777123456")).toBe("mobile");
    expect(czechPhoneType("+420602123456")).toBe("mobile");
    expect(czechPhoneType("+420703123456")).toBe("mobile");
    expect(czechPhoneType("+420321724118")).toBe("fixed");
    expect(czechPhoneType("+420541217930")).toBe("fixed");
    expect(czechPhoneType("+420800123456")).toBe("unknown");
    expect(czechPhoneType("+421905123456")).toBe("unknown");
    expect(czechPhoneType(null)).toBe("unknown");
  });
});

describe("parseCustomerContact", () => {
  it("normalises phone, type and e-mail", () => {
    const r = parseCustomerContact({
      first_name: " Jana ",
      last_name: "Nováková",
      phone: "777 123 456",
      email: "Jana.Novakova@Example.cz",
      notes: "",
    });
    expect(r).toEqual({
      success: true,
      values: {
        first_name: "Jana",
        last_name: "Nováková",
        phone_e164: "+420777123456",
        phone_type: "mobile",
        email: "jana.novakova@example.cz",
        notes: null,
      },
    });
  });

  it("allows removing the phone and rejects invalid values", () => {
    const empty = parseCustomerContact({ first_name: "", last_name: "Novák", phone: "", email: "", notes: "" });
    expect(empty.success && empty.values).toMatchObject({ phone_e164: null, phone_type: "unknown" });
    const bad = parseCustomerContact({ first_name: "", last_name: "", phone: "123", email: "x@", notes: "" });
    expect(bad).toEqual({ success: false, fieldErrors: { phone: "invalid_phone", email: "invalid_email" } });
    const noName = parseCustomerContact({ first_name: " ", last_name: "", phone: "", email: "", notes: "" });
    expect(noName).toEqual({ success: false, fieldErrors: { last_name: "name_required" } });
  });
});
