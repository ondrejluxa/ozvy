import { NextResponse } from "next/server";
import { AuthError, requireContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { getCompanyRecord } from "@/lib/db/supabase/companies";
import { createSupabaseServerClient } from "@/lib/db/supabase/server-client";
import { DPA_BUCKET } from "@/lib/domain/dpa";
import { env } from "@/lib/env";

/**
 * Downloads the signed DPA through a 60-second signed URL (spec §22). The
 * signed URL is created with the operator's session, so storage policies apply.
 */
export async function GET(_request: Request, { params }: RouteContext<"/admin/companies/[companyId]/dpa">) {
  const { companyId } = await params;
  if (env.DATA_SOURCE !== "supabase") return new NextResponse(null, { status: 404 });
  let userId: string | null = null;
  try {
    userId = (await requireContext({ permission: "admin.access", companyId })).userId;
  } catch (err) {
    if (err instanceof AuthError) return new NextResponse(null, { status: err.reason === "forbidden" ? 403 : 401 });
    throw err;
  }
  const company = await getCompanyRecord(companyId);
  if (!company?.dpa_document_path) return new NextResponse(null, { status: 404 });

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.storage.from(DPA_BUCKET).createSignedUrl(company.dpa_document_path, 60, {
    download: `zpracovatelska-smlouva-${companyId.slice(0, 8)}.pdf`,
  });
  if (error || !data) return new NextResponse(null, { status: 404 });

  await audit({
    action: "company.document_downloaded",
    actorType: "admin",
    actorUserId: userId,
    companyId,
    entityType: "company",
    entityId: companyId,
    metadata: { document: "dpa" },
  });
  return NextResponse.redirect(data.signedUrl, 303);
}
