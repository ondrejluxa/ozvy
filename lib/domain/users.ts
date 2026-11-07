/**
 * Shop user management (spec §20 users.invite, §23 user.role_changed /
 * user.removed). Owners and the operator change roles and remove members;
 * a shop always keeps at least one owner (also enforced by the database
 * trigger app.keep_last_owner).
 */

export type ShopRole = "shop_owner" | "shop_manager";
export const SHOP_ROLES: ShopRole[] = ["shop_owner", "shop_manager"];

export interface MemberLite {
  userId: string;
  role: ShopRole;
}

export type MemberChange = { userId: string; role: ShopRole } | { userId: string; remove: true };
export type MemberChangeIssue = "not_member" | "unchanged" | "last_owner";

export function memberChangeIssue(members: MemberLite[], change: MemberChange): MemberChangeIssue | null {
  const target = members.find((m) => m.userId === change.userId);
  if (!target) return "not_member";
  const removing = "remove" in change;
  if (!removing && target.role === change.role) return "unchanged";
  const losesOwner = target.role === "shop_owner" && (removing || change.role !== "shop_owner");
  if (losesOwner && members.filter((m) => m.role === "shop_owner").length <= 1) return "last_owner";
  return null;
}
