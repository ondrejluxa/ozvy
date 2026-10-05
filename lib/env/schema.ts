import { z } from "zod";

/**
 * Environment schema (spec §39) and the boot-time safety rules. Pure and
 * framework-free so the rules are unit-tested; lib/env.ts applies it to
 * process.env once at server start and refuses to boot on any violation.
 */

const optional = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const e164List = z
  .string()
  .optional()
  .transform((v, ctx) => {
    const items = (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const item of items) {
      if (!/^\+\d{8,15}$/.test(item)) {
        ctx.addIssue({ code: "custom", message: `SMS_TEST_WHITELIST entry is not E.164: ${item}` });
      }
    }
    return items;
  });

const schema = z
  .object({
    // App
    APP_ENV: z.enum(["local", "staging", "production"]).default("local"),
    NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
    // Short opt-out domain shown inside rendered SMS (no scheme, saves characters).
    OPT_OUT_BASE_URL: z.string().default("example.cz/o"),

    // Data: "demo" = in-memory seed for sales demos, "supabase" = the real MVP.
    DATA_SOURCE: z.enum(["demo", "supabase"]).default("demo"),
    DEMO_MODE: z.enum(["true", "false"]).optional(),

    // Supabase
    NEXT_PUBLIC_SUPABASE_URL: optional,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: optional,
    SUPABASE_SERVICE_ROLE_KEY: optional,
    SUPABASE_DB_URL: optional,

    // Jobs
    INNGEST_EVENT_KEY: optional,
    INNGEST_SIGNING_KEY: optional,

    // Messaging
    SMS_PROVIDER: z.string().trim().min(1).default("mock"),
    SMS_PROVIDER_API_KEY: optional,
    SMS_PROVIDER_API_SECRET: optional,
    SMS_WEBHOOK_SECRET: optional,
    SMS_TEST_WHITELIST: e164List,
    // Transactional email (invites, password resets, approvals). "smtp" = local Mailpit in development.
    EMAIL_PROVIDER: z.enum(["mock", "smtp"]).default("mock"),
    SMTP_URL: optional,
    EMAIL_PROVIDER_API_KEY: optional,
    EMAIL_FROM: z.string().default("Návrat <no-reply@example.com>"),

    // AI
    AI_PROVIDER: z.enum(["mock", "openai", "anthropic"]).default("mock"),
    AI_MODEL: optional,
    AI_API_KEY: optional,

    // Security
    SUPPRESSION_PEPPER: optional,
    UPSTASH_REDIS_REST_URL: optional,
    UPSTASH_REDIS_REST_TOKEN: optional,

    // Monitoring
    SENTRY_DSN: optional,
    NEXT_PUBLIC_SENTRY_DSN: optional,
  })
  .transform((raw) => ({
    ...raw,
    // Demo data is always labelled; real data is never labelled as demo.
    DEMO_MODE: (raw.DEMO_MODE ?? (raw.DATA_SOURCE === "demo" ? "true" : "false")) === "true",
  }))
  .superRefine((env, ctx) => {
    const fail = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });

    if (env.DATA_SOURCE === "demo" && !env.DEMO_MODE) {
      fail("DEMO_MODE", "Demo data must always be labelled: DEMO_MODE cannot be false while DATA_SOURCE=demo.");
    }
    if (env.DATA_SOURCE === "supabase" && env.DEMO_MODE) {
      fail("DEMO_MODE", "Real data must not be labelled as demo: DEMO_MODE must be false with DATA_SOURCE=supabase.");
    }
    if (env.APP_ENV === "production" && env.DATA_SOURCE !== "supabase") {
      fail("DATA_SOURCE", "Production must run on DATA_SOURCE=supabase.");
    }

    if (env.DATA_SOURCE === "supabase") {
      for (const key of [
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
      ] as const) {
        if (!env[key]) fail(key, `${key} is required with DATA_SOURCE=supabase.`);
      }
      if (!env.SUPPRESSION_PEPPER || env.SUPPRESSION_PEPPER.length < 40) {
        fail("SUPPRESSION_PEPPER", "SUPPRESSION_PEPPER must be 32+ random bytes (base64) with DATA_SOURCE=supabase.");
      }
    }

    // Spec §16 / §39: outside production only the mock provider may send,
    // except to an explicit whitelist of the operator's own phones.
    if (env.SMS_PROVIDER !== "mock") {
      if (env.APP_ENV !== "production" && env.SMS_TEST_WHITELIST.length === 0) {
        fail("SMS_TEST_WHITELIST", "A real SMS provider outside production requires SMS_TEST_WHITELIST.");
      }
      if (!env.SMS_PROVIDER_API_KEY)
        fail("SMS_PROVIDER_API_KEY", "SMS_PROVIDER_API_KEY is required for a real SMS provider.");
      if (!env.SMS_WEBHOOK_SECRET)
        fail("SMS_WEBHOOK_SECRET", "SMS_WEBHOOK_SECRET is required for a real SMS provider.");
    }
    if (env.APP_ENV === "production" && env.SMS_PROVIDER === "mock") {
      fail("SMS_PROVIDER", "Production cannot use the mock SMS provider.");
    }
    if (env.EMAIL_PROVIDER === "smtp" && !env.SMTP_URL) {
      fail("SMTP_URL", "SMTP_URL is required with EMAIL_PROVIDER=smtp.");
    }
    if (env.APP_ENV === "production" && env.EMAIL_PROVIDER === "mock") {
      fail("EMAIL_PROVIDER", "Production cannot use the mock email provider.");
    }

    if (env.AI_PROVIDER !== "mock" && (!env.AI_API_KEY || !env.AI_MODEL)) {
      fail("AI_API_KEY", "AI_API_KEY and AI_MODEL are required for a real AI provider.");
    }
    if (env.APP_ENV === "production" && (!env.INNGEST_EVENT_KEY || !env.INNGEST_SIGNING_KEY)) {
      fail("INNGEST_SIGNING_KEY", "INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY are required in production.");
    }
  });

export type Env = z.output<typeof schema>;

export class EnvError extends Error {
  constructor(public issues: string[]) {
    super(`Invalid environment:\n- ${issues.join("\n- ")}`);
    this.name = "EnvError";
  }
}

export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new EnvError(result.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`));
  }
  return result.data;
}
