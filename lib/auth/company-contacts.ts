import "server-only";
import { createServiceClient } from "../db/supabase/service-client";

/**
 * E-mail addresses of a company's owners, for transactional mail only
 * (approval requests). Auth e-mails are not readable through RLS, so this
 * server-only module uses the service role, filtered by company.
 */
export async function ownerEmails(companyId: string): Promise<string[]> {
  const db = createServiceClient();
  const { data } = await db.from("memberships").select("user_id").eq("company_id", companyId).eq("role", "shop_owner");
  const emails: string[] = [];
  for (const m of data ?? []) {
    const { data: user } = await db.auth.admin.getUserById(m.user_id);
    if (user.user?.email) emails.push(user.user.email);
  }
  return emails;
}
