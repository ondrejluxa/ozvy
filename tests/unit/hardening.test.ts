import { describe, expect, it } from "vitest";
import { scrubDeep, scrubText } from "@/lib/domain/pii";
import { clientIp, RATE_LIMITS, rateLimitKey } from "@/lib/domain/rate-limit";
import { SUPPORT_REASONS } from "@/lib/domain/support-view";

describe("PII scrubbing (spec §25: no phones or e-mails in Sentry or logs)", () => {
  it.each([
    ["call +420 777 123 456 now", "call [phone] now"],
    ["777123456", "[phone]"],
    ["00420777123456 failed", "[phone] failed"],
    ["to jana.novakova@example.cz", "to [email]"],
    ["Customer jan@example.com, tel. 777-123-456", "Customer [email], tel. [phone]"],
  ])("%s → %s", (input, output) => {
    expect(scrubText(input)).toBe(output);
  });

  it("keeps ids, amounts and dates readable", () => {
    const text = "campaign 0f8fad5b-d9cb-469f-a165-70867728950e failed: 480000 haléřů on 2026-11-05";
    expect(scrubText(text)).toBe(text);
  });

  it("scrubs nested event data and drops contact fields by name", () => {
    const event = {
      message: "send to +420777123456 failed",
      extra: { to_address: "+420777000001", list: ["a@b.cz", 5], nested: { email: "x@y.cz", ok: true } },
      request: { headers: { cookie: "sb-access-token=…", Authorization: "Bearer x" } },
    };
    expect(scrubDeep(event)).toEqual({
      message: "send to [phone] failed",
      extra: { to_address: "[redacted]", list: ["[email]", 5], nested: { email: "[redacted]", ok: true } },
      request: { headers: { cookie: "[redacted]", Authorization: "[redacted]" } },
    });
    expect(event.extra.to_address).toBe("+420777000001"); // the original is untouched
  });
});

describe("rate limits (spec §22)", () => {
  it("AI is limited to 30 generations per user and hour", () => {
    expect(RATE_LIMITS.ai).toEqual({ limit: 30, windowSeconds: 3600 });
  });

  it("locks an e-mail after 5 failed sign-ins in 15 minutes; a shared IP gets 20", () => {
    expect(RATE_LIMITS.login).toEqual({ limit: 5, windowSeconds: 900, ipLimit: 20 });
  });

  it("keys never contain the raw IP or e-mail and are case-insensitive", () => {
    const key = rateLimitKey("login", "email", "Jana@Example.cz");
    expect(key).toMatch(/^login:email:[0-9a-f]{32}$/);
    expect(key).not.toContain("example");
    expect(rateLimitKey("login", "email", "jana@example.cz ")).toBe(key);
    expect(rateLimitKey("login", "ip", "jana@example.cz")).not.toBe(key);
  });

  it("takes the client IP from the first forwarded address", () => {
    const h = (values: Record<string, string>) => ({ get: (n: string) => values[n] ?? null });
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(h({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(h({}))).toBe("unknown");
  });
});

describe("support view", () => {
  it("always asks for one of the documented reasons", () => {
    expect(SUPPORT_REASONS).toContain("client_request");
    expect(new Set(SUPPORT_REASONS).size).toBe(SUPPORT_REASONS.length);
  });
});
