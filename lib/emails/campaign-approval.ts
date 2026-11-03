import "server-only";
import { getTranslations } from "next-intl/server";
import type { OutboundEmail } from "../providers/email";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * "Kampaň čeká na schválení" (spec §6 F4) for the shop owner. No customer
 * data: the campaign name, recipient count, send time and a link.
 */
export async function campaignApprovalEmail(input: {
  to: string;
  companyName: string;
  campaignName: string;
  recipients: number;
  sendAt: string;
  link: string;
}): Promise<OutboundEmail> {
  const t = await getTranslations("emails.campaignApproval");
  const lines = [
    t("greeting"),
    t("body", { company: input.companyName, campaign: input.campaignName }),
    t("details", { recipients: input.recipients, sendAt: input.sendAt }),
  ];
  const cta = t("cta");
  return {
    to: input.to,
    subject: t("subject", { campaign: input.campaignName }),
    text: [...lines, "", `${cta}: ${input.link}`, "", t("footer")].join("\n"),
    html: [
      ...lines.map((l) => `<p>${escapeHtml(l)}</p>`),
      `<p><a href="${escapeHtml(input.link)}">${escapeHtml(cta)}</a></p>`,
      `<p>${escapeHtml(t("footer"))}</p>`,
    ].join("\n"),
  };
}
