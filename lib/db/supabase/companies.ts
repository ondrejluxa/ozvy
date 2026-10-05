import "server-only";
import { createSupabaseServerClient } from "./server-client";

/**
 * Company reads for DATA_SOURCE=supabase, through the signed-in user's
 * session: RLS decides which companies are visible (all for the platform
 * admin, own company for shop users).
 */

export interface CompanyListItem {
  id: string;
  name: string;
  city: string | null;
  status: string;
  sendingEnabled: boolean;
  createdAt: string;
}

export async function listVisibleCompanies(): Promise<CompanyListItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("companies")
    .select("id, name, city, status, sending_enabled, created_at")
    .order("name");
  if (error) throw new Error(`companies query failed: ${error.code}`);
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    city: c.city,
    status: c.status,
    sendingEnabled: c.sending_enabled,
    createdAt: c.created_at,
  }));
}
