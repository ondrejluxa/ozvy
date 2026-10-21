import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";

/** Test helpers for the local Supabase E2E suite. Local stack only. */

function localEnv(): Record<string, string> {
  const raw = readFileSync(join(process.cwd(), ".env.supabase.local"), "utf8");
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .map((l) => /^([A-Z_]+)=(.*)$/.exec(l))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => [m[1], m[2]]),
  );
}

export const env = localEnv();
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(env.NEXT_PUBLIC_SUPABASE_URL ?? "")) {
  throw new Error("E2E helpers only run against a local Supabase stack.");
}

export const service = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/** Public (anon) client, as an anonymous visitor would use it. */
export const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

export const run = Date.now().toString(36);
export const PASSWORD = "TestovaciHeslo2026";

export function email(label: string): string {
  return `e2e-${label}-${run}@example.cz`;
}

export async function createUser(address: string, fullName: string, password = PASSWORD): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: address,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  return data.user.id;
}

export async function createCompany(name: string): Promise<string> {
  const { data, error } = await service
    .from("companies")
    .insert({ name, city: "Kolín", status: "active" })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("createCompany failed");
  return data.id;
}

export async function cleanup(userIds: string[], companyIds: string[]) {
  for (const id of userIds) await service.auth.admin.deleteUser(id);
  if (companyIds.length) await service.from("companies").delete().in("id", companyIds);
}

// ---------- TOTP (RFC 6238, SHA-1, 6 digits, 30 s) ----------

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of input.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totp(secret: string, step = Math.floor(Date.now() / 30_000)): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

/** A code from a time step not used before (TOTP codes are single-use per step). */
export async function freshTotp(secret: string, usedSteps: Set<number>): Promise<string> {
  let step = Math.floor(Date.now() / 30_000);
  while (usedSteps.has(step)) {
    await new Promise((r) => setTimeout(r, 1000));
    step = Math.floor(Date.now() / 30_000);
  }
  usedSteps.add(step);
  return totp(secret, step);
}

// ---------- Mailpit (local inbox) ----------

const MAILPIT = "http://127.0.0.1:54324";

export async function latestEmailLink(to: string, pattern: RegExp, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`).then((r) =>
      r.json(),
    );
    const id = search.messages?.[0]?.ID;
    if (id) {
      const message = await fetch(`${MAILPIT}/api/v1/message/${id}`).then((r) => r.json());
      const html: string = message.HTML || message.Text || "";
      const match = pattern.exec(html.replace(/&amp;/g, "&"));
      if (match) return match[0];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email to ${to} matching ${pattern}`);
}

export async function signIn(page: Page, address: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(address);
  await page.getByLabel("Heslo", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Přihlásit se" }).click();
}

export const unique = () => randomBytes(4).toString("hex");
