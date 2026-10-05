import "server-only";
import { getTranslations } from "next-intl/server";
import type { OutboundEmail } from "../providers/email";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Czech invitation email (text + HTML). Strings live in messages/cs.json under emails.invitation. */
export async function invitationEmail(input: {
  to: string;
  companyName: string;
  role: "shop_owner" | "shop_manager";
  link: string;
}): Promise<OutboundEmail> {
  const t = await getTranslations("emails.invitation");
  const role = t(`roles.${input.role}`);
  const greeting = t("greeting");
  const body = t("body", { company: input.companyName, role });
  const validity = t("validity");
  const cta = t("cta");
  const ignore = t("ignore");
  return {
    to: input.to,
    subject: t("subject", { company: input.companyName }),
    text: [greeting, "", body, "", `${cta}: ${input.link}`, "", validity, ignore].join("\n"),
    html: [
      `<p>${escapeHtml(greeting)}</p>`,
      `<p>${escapeHtml(body)}</p>`,
      `<p><a href="${escapeHtml(input.link)}">${escapeHtml(cta)}</a></p>`,
      `<p>${escapeHtml(validity)} ${escapeHtml(ignore)}</p>`,
    ].join("\n"),
  };
}
