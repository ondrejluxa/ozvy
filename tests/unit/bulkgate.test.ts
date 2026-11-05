import { describe, expect, it } from "vitest";
import { isOptOutKeyword, secretsEqual, suppressionHash, toE164 } from "@/lib/domain/messaging/opt-out";
import { BULKGATE_SEND_URL, createBulkGateProvider } from "@/lib/providers/sms/bulkgate";
import { createMockSmsProvider } from "@/lib/providers/sms/mock";

const SECRET = "s".repeat(40);

/** A fake fetch that records requests and answers with a fixed status and JSON. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { fn, calls };
}

function provider(fetchImpl: typeof fetch) {
  return createBulkGateProvider({
    applicationId: "12345",
    applicationToken: "token",
    webhookSecret: SECRET,
    pricePerSegmentMinor: 90,
    fetch: fetchImpl,
  });
}

const msg = {
  to: "+420777123456",
  body: "Dobrý den, servis čeká. Odhlásit: example.cz/o/Abc23456",
  senderId: "AutoDvorak",
  idempotencyKey: "k",
};

describe("opt-out rules", () => {
  it.each(["STOP", "stop", " Odhlásit. ", "ODHLASIT", "ne", "NE!"])("%s is an opt-out keyword", (t) => {
    expect(isOptOutKeyword(t)).toBe(true);
  });
  it.each(["Ne, děkuji, přijedu příští týden", "Dobrý den", "STOPKA", ""])("%s is a normal reply", (t) => {
    expect(isOptOutKeyword(t)).toBe(false);
  });

  it("hashes numbers with the pepper and never stores them", () => {
    const h = suppressionHash("+420777123456", "pepper-1");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("777123456");
    expect(suppressionHash("+420777123456", "pepper-1")).toBe(h);
    expect(suppressionHash("+420777123456", "pepper-2")).not.toBe(h);
    expect(() => suppressionHash("+420777123456", "")).toThrow();
  });

  it("normalises gateway numbers and compares secrets safely", () => {
    expect(toE164("420777123456")).toBe("+420777123456");
    expect(toE164("00420 777 123 456")).toBe("+420777123456");
    expect(toE164("abc")).toBeNull();
    expect(secretsEqual("a", "a")).toBe(true);
    expect(secretsEqual("a", "b")).toBe(false);
    expect(secretsEqual("a", "aa")).toBe(false);
    expect(secretsEqual(null, "a")).toBe(false);
    expect(secretsEqual("a", undefined)).toBe(false);
  });
});

describe("BulkGate send", () => {
  it("posts the documented JSON and maps an accepted message", async () => {
    const http = fakeFetch(200, {
      data: { status: "accepted", sms_id: "tmp123", part_id: ["tmp123"], number: "420777123456" },
    });
    const res = await provider(http.fn).send(msg);
    expect(res).toEqual({
      ok: true,
      providerMessageId: "tmp123",
      segments: 1,
      cost: { amountMinor: 90, currency: "CZK" },
    });
    expect(http.calls[0].url).toBe(BULKGATE_SEND_URL);
    expect(http.calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(http.calls[0].init.body))).toEqual({
      application_id: "12345",
      application_token: "token",
      number: "420777123456",
      text: msg.body,
      unicode: true,
      sender_id: "gText",
      sender_id_value: "AutoDvorak",
      duplicates_check: "on",
    });
  });

  it("uses the system sender for names a gateway would reject and GSM text without unicode", async () => {
    const http = fakeFetch(200, { data: { status: "accepted", sms_id: "x" } });
    await provider(http.fn).send({ ...msg, body: "Dobry den {{x}}", senderId: "Autoservis Dvořák s.r.o." });
    const sent = JSON.parse(String(http.calls[0].init.body));
    expect(sent).toMatchObject({ sender_id: "gSystem", unicode: false });
    expect(sent.sender_id_value).toBeUndefined();
  });

  it("documented errors are permanent; 5xx and 429 are retryable", async () => {
    const bad = await provider(
      fakeFetch(400, { type: "invalid_phone_number", code: 400, error: "Invalid phone number", detail: null }).fn,
    ).send(msg);
    expect(bad).toEqual({
      ok: false,
      retryable: false,
      code: "bulkgate_invalid_phone_number",
      detail: "Invalid phone number",
    });
    const down = await provider(fakeFetch(503, { type: "unknown", code: 503, error: "Service unavailable" }).fn).send(
      msg,
    );
    expect(down).toMatchObject({ ok: false, retryable: true });
    const limited = await provider(fakeFetch(429, {}).fn).send(msg);
    expect(limited).toMatchObject({ ok: false, retryable: true, code: "bulkgate_unknown" });
  });

  it("a network error throws (unknown outcome: manual review, never an automatic retry)", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(provider(failing).send(msg)).rejects.toThrow("fetch failed");
  });
});

describe("BulkGate callbacks", () => {
  const url = (q: string) => `https://app.example.cz/api/webhooks/sms/bulkgate?secret=${SECRET}&${q}`;

  it("accepts only the shared secret", async () => {
    const p = provider(fakeFetch(200, {}).fn);
    expect(await p.verifyWebhook!(new Request(url("status=1&smsID=a")))).toBe(true);
    expect(await p.verifyWebhook!(new Request("https://app.example.cz/api/webhooks/sms/bulkgate?secret=nope"))).toBe(
      false,
    );
    expect(await p.verifyWebhook!(new Request("https://app.example.cz/api/webhooks/sms/bulkgate"))).toBe(false);
  });

  it("maps delivery reports (GET) without keeping the secret", async () => {
    const p = provider(fakeFetch(200, {}).fn);
    const [delivered] = await p.parseWebhook!(
      new Request(url("status=1&smsID=tmp1&price=0.5&channel=sms&date=2611091001;2611091002")),
    );
    expect(delivered).toMatchObject({
      kind: "delivery",
      providerEventId: "tmp1:1",
      providerMessageId: "tmp1",
      status: "delivered",
    });
    expect(JSON.stringify(delivered.payload)).not.toContain(SECRET);
    const [failed] = await p.parseWebhook!(new Request(url("status=3&smsID=tmp2")));
    expect(failed).toMatchObject({ kind: "delivery", status: "undelivered", providerEventId: "tmp2:3" });
    const [queued] = await p.parseWebhook!(new Request(url("status=2&smsID=tmp3")));
    expect(queued.kind).toBe("other");
  });

  it("maps inbound SMS and bulk POST reports", async () => {
    const p = provider(fakeFetch(200, {}).fn);
    const events = await p.parseWebhook!(
      new Request(url(""), {
        method: "POST",
        body: JSON.stringify([
          { status: "10", from: "420777123456", message: "STOP", date: "2611091005" },
          { status: "1", smsID: "tmp9" },
        ]),
      }),
    );
    expect(events[0]).toMatchObject({ kind: "inbound", from: "+420777123456", text: "STOP" });
    expect(events[1]).toMatchObject({ kind: "delivery", providerMessageId: "tmp9" });
  });
});

describe("mock callbacks", () => {
  it("uses the same secret check and event shapes", async () => {
    const p = createMockSmsProvider({ webhookSecret: SECRET });
    const req = () =>
      new Request(`https://x.example.cz/api/webhooks/sms/mock?secret=${SECRET}`, {
        method: "POST",
        body: JSON.stringify({
          events: [
            { type: "delivered", messageId: "mock_1" },
            { type: "inbound", from: "420777000001", text: "ne" },
            { type: "weird" },
          ],
        }),
      });
    expect(await p.verifyWebhook!(req())).toBe(true);
    const events = await p.parseWebhook!(req());
    expect(events.map((e) => e.kind)).toEqual(["delivery", "inbound", "other"]);
    expect(events[1]).toMatchObject({ from: "+420777000001", text: "ne" });
    expect(await createMockSmsProvider().verifyWebhook!(req())).toBe(false);
  });
});
