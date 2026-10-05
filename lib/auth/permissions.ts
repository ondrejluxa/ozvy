import type { CompanyRole, ServiceMode } from "../db/types";

/**
 * Permission matrix (spec §20). One TypeScript map, no policy engine. The UI
 * hides actions the user lacks, server actions re-check with requireContext,
 * and RLS is the final guard; all three must agree.
 */

export type Permission =
  | "dashboard.view"
  | "customers.view"
  | "customers.edit_contact"
  | "customers.export"
  | "customers.delete"
  | "conversions.mark"
  | "imports.run"
  | "segments.manage"
  | "campaigns.create"
  | "campaigns.approve"
  | "campaigns.pause"
  | "settings.company"
  | "users.invite"
  | "billing.view"
  | "admin.access";

export const PERMISSIONS: Permission[] = [
  "dashboard.view",
  "customers.view",
  "customers.edit_contact",
  "customers.export",
  "customers.delete",
  "conversions.mark",
  "imports.run",
  "segments.manage",
  "campaigns.create",
  "campaigns.approve",
  "campaigns.pause",
  "settings.company",
  "users.invite",
  "billing.view",
  "admin.access",
];

/** A company-scoped actor: their role there plus the company's mode. */
export interface CompanySubject {
  isPlatformAdmin: boolean;
  role: CompanyRole | null;
  serviceMode: ServiceMode;
  requiresClientApproval: boolean;
}

type Rule = boolean | ((s: CompanySubject) => boolean);

// Columns of spec §20: shop_owner (managed), shop_owner (self-service), shop_manager.
const MATRIX: Record<Permission, { managedOwner: Rule; selfServiceOwner: Rule; manager: Rule }> = {
  "dashboard.view": { managedOwner: true, selfServiceOwner: true, manager: true },
  "customers.view": { managedOwner: true, selfServiceOwner: true, manager: true },
  "customers.edit_contact": { managedOwner: true, selfServiceOwner: true, manager: true },
  "customers.export": { managedOwner: true, selfServiceOwner: true, manager: false },
  // Managed owners can only *request* deletion (data subject request flow).
  "customers.delete": { managedOwner: false, selfServiceOwner: true, manager: false },
  "conversions.mark": { managedOwner: true, selfServiceOwner: true, manager: true },
  "imports.run": { managedOwner: false, selfServiceOwner: true, manager: false },
  "segments.manage": { managedOwner: false, selfServiceOwner: true, manager: false },
  "campaigns.create": { managedOwner: false, selfServiceOwner: true, manager: false },
  "campaigns.approve": { managedOwner: (s) => s.requiresClientApproval, selfServiceOwner: true, manager: false },
  // The owner can always pause a campaign, even in managed mode.
  "campaigns.pause": { managedOwner: true, selfServiceOwner: true, manager: false },
  "settings.company": { managedOwner: true, selfServiceOwner: true, manager: false },
  "users.invite": { managedOwner: true, selfServiceOwner: true, manager: false },
  "billing.view": { managedOwner: true, selfServiceOwner: true, manager: false },
  "admin.access": { managedOwner: false, selfServiceOwner: false, manager: false },
};

export function can(subject: CompanySubject, permission: Permission): boolean {
  if (subject.isPlatformAdmin) return true;
  if (!subject.role) return false;
  const row = MATRIX[permission];
  const rule =
    subject.role === "shop_manager"
      ? row.manager
      : subject.serviceMode === "self_service"
        ? row.selfServiceOwner
        : row.managedOwner;
  return typeof rule === "function" ? rule(subject) : rule;
}
