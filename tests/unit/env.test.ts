import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "@/lib/env/schema";

const PEPPER = "a".repeat(44);
const supabase = {
  DATA_SOURCE: "supabase",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  SUPPRESSION_PEPPER: PEPPER,
};

function issues(raw: Record<string, string | undefined>): string[] {
  try {
    parseEnv(raw);
    return [];
  } catch (e) {
    if (e instanceof EnvError) return e.issues;
    throw e;
  }
}

describe("parseEnv", () => {
  it("defaults to a labelled demo with mock providers", () => {
    const env = parseEnv({});
    expect(env).toMatchObject({
      APP_ENV: "local",
      DATA_SOURCE: "demo",
      DEMO_MODE: true,
      SMS_PROVIDER: "mock",
      AI_PROVIDER: "mock",
    });
  });

  it("never lets demo data run unlabelled", () => {
    expect(issues({ DEMO_MODE: "false" }).join()).toMatch(/DEMO_MODE/);
  });

  it("never labels real data as demo", () => {
    expect(parseEnv(supabase).DEMO_MODE).toBe(false);
    expect(issues({ ...supabase, DEMO_MODE: "true" }).join()).toMatch(/DEMO_MODE/);
  });

  it("requires Supabase keys and a pepper for DATA_SOURCE=supabase", () => {
    const found = issues({ DATA_SOURCE: "supabase" }).join("\n");
    expect(found).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(found).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(found).toMatch(/SUPPRESSION_PEPPER/);
    expect(issues({ ...supabase, SUPPRESSION_PEPPER: "short" }).join()).toMatch(/SUPPRESSION_PEPPER/);
  });

  it("refuses a real SMS provider outside production without a whitelist", () => {
    const real = { SMS_PROVIDER: "gosms", SMS_PROVIDER_API_KEY: "k", SMS_WEBHOOK_SECRET: "s" };
    expect(issues({ ...real, APP_ENV: "staging" }).join()).toMatch(/SMS_TEST_WHITELIST/);
    expect(
      parseEnv({ ...real, APP_ENV: "staging", SMS_TEST_WHITELIST: "+420777000111, +420777000222" }).SMS_TEST_WHITELIST,
    ).toEqual(["+420777000111", "+420777000222"]);
    expect(issues({ ...real, SMS_TEST_WHITELIST: "777000111" }).join()).toMatch(/E\.164/);
  });

  it("requires real providers and real data in production", () => {
    const found = issues({ APP_ENV: "production" }).join("\n");
    expect(found).toMatch(/DATA_SOURCE/);
    expect(found).toMatch(/mock SMS provider/);
    expect(found).toMatch(/INNGEST/);
    expect(found).toMatch(/JOB_RUNNER/);
  });

  it("keeps the real-looking-data importer flag out of production", () => {
    expect(parseEnv({ DEV_ALLOW_REAL_LOOKING_DATA: "true" }).DEV_ALLOW_REAL_LOOKING_DATA).toBe("true");
    expect(issues({ APP_ENV: "production", DEV_ALLOW_REAL_LOOKING_DATA: "true" }).join()).toMatch(/development flag/);
  });

  it("accepts a complete production configuration", () => {
    const env = parseEnv({
      ...supabase,
      APP_ENV: "production",
      SMS_PROVIDER: "gosms",
      SMS_PROVIDER_API_KEY: "k",
      SMS_WEBHOOK_SECRET: "s",
      INNGEST_EVENT_KEY: "e",
      INNGEST_SIGNING_KEY: "s",
      JOB_RUNNER: "inngest",
      EMAIL_PROVIDER: "smtp",
      SMTP_URL: "smtp://mail.example.com:587",
    });
    expect(env.DEMO_MODE).toBe(false);
  });

  it("requires credentials for a real AI provider", () => {
    expect(issues({ AI_PROVIDER: "anthropic" }).join()).toMatch(/AI_API_KEY/);
  });
});

describe("email provider rules", () => {
  it("requires an SMTP URL for smtp and a real provider in production", () => {
    expect(issues({ EMAIL_PROVIDER: "smtp" }).join()).toMatch(/SMTP_URL/);
    expect(parseEnv({ EMAIL_PROVIDER: "smtp", SMTP_URL: "smtp://127.0.0.1:54325" }).EMAIL_PROVIDER).toBe("smtp");
    expect(issues({ APP_ENV: "production" }).join()).toMatch(/mock email provider/);
  });
});
