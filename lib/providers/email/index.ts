import "server-only";
import nodemailer from "nodemailer";
import { env } from "../../env";

/**
 * Transactional email (spec §16 "Email", §27): invitations now, approvals and
 * monthly reports later. Providers sit behind one small interface:
 *   mock - in-memory outbox (tests, demo)
 *   smtp - any SMTP server; locally the Mailpit inbox that `supabase start` runs
 * A hosted provider (Resend/Postmark, EU) is one more adapter before production.
 */

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailProvider {
  readonly id: string;
  send(message: OutboundEmail): Promise<void>;
}

const OUTBOX = Symbol.for("navrat.mock-email-outbox");
type GlobalWithOutbox = typeof globalThis & { [OUTBOX]?: OutboundEmail[] };

/** Mock outbox contents (tests only). */
export function mockOutbox(): OutboundEmail[] {
  const g = globalThis as GlobalWithOutbox;
  g[OUTBOX] ??= [];
  return g[OUTBOX];
}

function mockProvider(): EmailProvider {
  return {
    id: "mock",
    async send(message) {
      mockOutbox().push(message);
      // Never log recipients or bodies: they can contain personal data and tokens.
      console.info(`[email:mock] queued "${message.subject}"`);
    },
  };
}

function smtpProvider(url: string): EmailProvider {
  const transport = nodemailer.createTransport(url);
  return {
    id: "smtp",
    async send(message) {
      await transport.sendMail({ from: env.EMAIL_FROM, ...message });
    },
  };
}

let provider: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  provider ??= env.EMAIL_PROVIDER === "smtp" ? smtpProvider(env.SMTP_URL!) : mockProvider();
  return provider;
}
