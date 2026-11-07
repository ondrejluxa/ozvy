"use client";

import { useTranslations } from "next-intl";
import { ConfirmAction, useActionCall } from "@/components/common/confirm-action";
import { Select } from "@/components/ui/inputs";
import { changeMemberRoleAction, removeMemberAction, revokeInvitationAction } from "@/lib/actions/users";
import { formatDate } from "@/lib/domain/dates";
import type { ShopRole } from "@/lib/domain/users";

export interface MemberView {
  userId: string;
  fullName: string | null;
  role: ShopRole;
  since: string;
}

export interface PendingInvitationView {
  id: string;
  email: string;
  role: ShopRole;
  expiresAt: string;
}

/**
 * Users of one shop (spec §8 Nastavení → Uživatelé, §20 users.invite). With
 * `canManage` (owners, the operator) roles can be changed and members removed;
 * the last owner is protected here, in the server action and in the database.
 */
export function MemberList({
  companyId,
  members,
  pending,
  canManage,
  currentUserId,
}: {
  companyId: string;
  members: MemberView[];
  pending: PendingInvitationView[];
  canManage: boolean;
  currentUserId: string | null;
}) {
  const t = useTranslations("members");
  const tForm = useTranslations("companyForm");
  const tRoles = useTranslations("realData.invite.roles");
  const { pending: saving, call } = useActionCall();
  const owners = members.filter((m) => m.role === "shop_owner").length;

  return (
    <ul className="divide-y divide-line text-sm" data-testid="company-users">
      {members.map((m) => {
        const name = m.fullName ?? tForm("users.noName");
        const isSelf = m.userId === currentUserId;
        const lastOwner = m.role === "shop_owner" && owners <= 1;
        return (
          <li
            key={m.userId}
            className="flex flex-col gap-2 py-3 first:pt-0 sm:flex-row sm:items-center sm:justify-between"
            data-testid="member-row"
          >
            <div className="min-w-0">
              <p className="font-medium text-ink">
                {name}
                {isSelf && <span className="font-normal text-muted"> ({t("you")})</span>}
              </p>
              <p className="text-[13px] text-muted">{tForm("users.since", { date: formatDate(m.since) })}</p>
            </div>
            {canManage ? (
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  aria-label={t("changeRole", { name })}
                  value={m.role}
                  disabled={saving || lastOwner}
                  title={lastOwner ? t("lastOwnerHint") : undefined}
                  className="h-8 w-auto text-[13px]"
                  onChange={(e) =>
                    call(
                      () => changeMemberRoleAction({ companyId, userId: m.userId, role: e.target.value }),
                      t("roleChanged"),
                    )
                  }
                >
                  <option value="shop_owner">{tRoles("shop_owner")}</option>
                  <option value="shop_manager">{tRoles("shop_manager")}</option>
                </Select>
                {!lastOwner && (
                  <ConfirmAction
                    label={t("remove")}
                    title={t("removeTitle", { name })}
                    description={isSelf ? t("removeSelfText") : t("removeText")}
                    confirmLabel={t("removeConfirm")}
                    success={t("removed")}
                    action={() => removeMemberAction({ companyId, userId: m.userId })}
                    variant="ghost"
                  />
                )}
              </div>
            ) : (
              <span className="text-[13px] text-muted">{tRoles(m.role)}</span>
            )}
          </li>
        );
      })}
      {pending.map((i) => (
        <li
          key={i.id}
          className="flex flex-col gap-2 py-3 first:pt-0 sm:flex-row sm:items-center sm:justify-between"
          data-testid="invitation-row"
        >
          <div className="min-w-0">
            <p className="break-all text-ink-2">{i.email}</p>
            <p className="text-[13px] text-muted">
              {tRoles(i.role)} · {tForm("users.pending", { date: formatDate(i.expiresAt) })}
            </p>
          </div>
          {canManage && (
            <ConfirmAction
              label={t("revoke")}
              title={t("revokeTitle", { email: i.email })}
              description={t("revokeText")}
              confirmLabel={t("revoke")}
              success={t("revoked")}
              action={() => revokeInvitationAction({ companyId, invitationId: i.id })}
              variant="ghost"
            />
          )}
        </li>
      ))}
    </ul>
  );
}
