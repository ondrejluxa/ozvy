import { NextResponse } from "next/server";
import { AuthError, requireContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { getCustomerExportSource } from "@/lib/db/supabase/privacy";
import { buildCustomerExport, exportFileName } from "@/lib/domain/privacy";
import { env } from "@/lib/env";

/**
 * Access request (spec §21): everything held about one customer as JSON.
 * Operator only; every download is audited as customer.exported.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/admin/companies/[companyId]/customers/[customerId]/export">,
) {
  const { companyId, customerId } = await params;
  if (env.DATA_SOURCE !== "supabase") return new NextResponse(null, { status: 404 });
  let userId: string | null;
  try {
    userId = (await requireContext({ permission: "admin.access", companyId }, { read: true })).userId;
  } catch (err) {
    if (err instanceof AuthError) return new NextResponse(null, { status: err.reason === "forbidden" ? 403 : 401 });
    throw err;
  }
  const source = await getCustomerExportSource(companyId, customerId);
  if (!source) return new NextResponse(null, { status: 404 });

  const now = new Date();
  await audit({
    action: "customer.exported",
    actorType: "admin",
    actorUserId: userId,
    companyId,
    entityType: "customer",
    entityId: customerId,
    metadata: { format: "json", purpose: "access_request" },
  });
  return new NextResponse(JSON.stringify(buildCustomerExport(source, now), null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFileName(customerId, now)}"`,
      "Cache-Control": "no-store",
    },
  });
}
