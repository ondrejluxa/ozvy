import { NextResponse } from "next/server";
import { requireClientCompany } from "@/lib/auth/client-company";
import { AuthError, requireContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { getCompanyRecord } from "@/lib/db/supabase/companies";
import { createSupabaseServerClient } from "@/lib/db/supabase/server-client";
import { DPA_BUCKET } from "@/lib/domain/dpa";
import { env } from "@/lib/env";

/**
 * The shop owner downloads their own signed DPA (spec §8 Nastavení → Data a
 * soukromí) through a 60-second signed URL; storage policies apply.
 */
export async function GET() {
  if (env.DATA_SOURCE !== "supabase") return new NextResponse(null, { status: 404 });
  const { membership } = await requireClientCompany("/app/settings?tab=data");
  let userId: string | null;
  let isAdmin: boolean;
  try {
    const ctx = await requireContext(
      { permission: "settings.company", companyId: membership.companyId },
      { read: true },
    );
    userId = ctx.userId;
    isAdmin = ctx.isPlatformAdmin;
  } catch (err) {
    if (err instanceof AuthError) return new NextResponse(null, { status: err.reason === "forbidden" ? 403 : 401 });
    throw err;
  }
  const company = await getCompanyRecord(membership.companyId);
  if (!company?.dpa_document_path) return new NextResponse(null, { status: 404 });

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.storage.from(DPA_BUCKET).createSignedUrl(company.dpa_document_path, 60, {
    download: `zpracovatelska-smlouva-${membership.companyId.slice(0, 8)}.pdf`,
  });
  if (error || !data) return new NextResponse(null, { status: 404 });

  await audit({
    action: "company.document_downloaded",
    actorType: isAdmin ? "admin" : "user",
    actorUserId: userId,
    companyId: membership.companyId,
    entityType: "company",
    entityId: membership.companyId,
    metadata: { document: "dpa" },
  });
  return NextResponse.redirect(data.signedUrl, 303);
}
