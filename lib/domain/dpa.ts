/**
 * Data processing agreement (zpracovatelská smlouva, GDPR Art. 28) gates
 * (spec §0.4, §6 F1 step 2, §19): the signed PDF is stored privately, and
 * neither imports nor sending are possible before it is confirmed.
 */

export const DPA_MAX_BYTES = 10 * 1024 * 1024;
export const DPA_BUCKET = "company-documents";

export type DpaFileIssue = "missing" | "too_large" | "not_pdf";

/** Checks an uploaded file by size, declared type and the "%PDF-" magic bytes. */
export function dpaFileIssue(file: { size: number; type: string; head: Uint8Array } | null): DpaFileIssue | null {
  if (!file || file.size === 0) return "missing";
  if (file.size > DPA_MAX_BYTES) return "too_large";
  const magic = String.fromCharCode(...file.head.slice(0, 5));
  if (magic !== "%PDF-" || (file.type && file.type !== "application/pdf")) return "not_pdf";
  return null;
}

/** Storage object path; the first folder is the company ID, which the storage policies check. */
export function dpaObjectPath(companyId: string, uploadId: string): string {
  return `${companyId}/dpa/${uploadId}.pdf`;
}

export type SendingBlocker = "dpa_missing" | "no_reviewed_import" | "company_inactive";

/**
 * Why sending cannot be switched on (spec §19): a confirmed DPA and at least
 * one import the operator reviewed and committed.
 */
export function sendingBlockers(company: {
  dpaSignedAt: string | null;
  status: string;
  hasCompletedImport: boolean;
}): SendingBlocker[] {
  const blockers: SendingBlocker[] = [];
  if (!company.dpaSignedAt) blockers.push("dpa_missing");
  if (!company.hasCompletedImport) blockers.push("no_reviewed_import");
  if (company.status === "offboarding" || company.status === "closed") blockers.push("company_inactive");
  return blockers;
}
