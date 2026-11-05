import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { AuthError, requireContext } from "@/lib/auth/context";
import { getImport, listProblemRows } from "@/lib/db/supabase/imports";
import { issuesCsv } from "@/lib/domain/imports/export";
import { env } from "@/lib/env";

/** "Stáhnout chyby": invalid, warning and duplicate rows with reasons (spec §11 steps 6 and 8). */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/admin/companies/[companyId]/imports/[importId]/errors">,
) {
  const { companyId, importId } = await params;
  if (env.DATA_SOURCE !== "supabase") return new NextResponse(null, { status: 404 });
  try {
    await requireContext({ permission: "imports.run", companyId }, { read: true });
  } catch (err) {
    if (err instanceof AuthError) return new NextResponse(null, { status: err.reason === "forbidden" ? 403 : 401 });
    throw err;
  }
  const imp = await getImport(companyId, importId);
  if (!imp) return new NextResponse(null, { status: 404 });
  const rows = await listProblemRows(companyId, importId);
  const t = await getTranslations("imports");
  const csv = issuesCsv(
    (imp.header as string[]) ?? [],
    rows.map((r) => ({
      rowNumber: r.row_number,
      status: r.status,
      issues: r.issues as string[],
      cells: r.raw as string[],
    })),
    {
      row: t("csv.row"),
      status: t("csv.status"),
      issues: t("csv.issues"),
      statusLabel: (s) => t(`review.${s as "valid"}`),
      issueLabel: (i) => t(`issues.${i as "no_contact"}`),
    },
  );
  const name = (imp.file_name ?? "import").replace(/\.[a-z0-9]+$/i, "").replace(/[^\w.-]+/g, "_");
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}-chyby.csv"`,
      "cache-control": "no-store",
    },
  });
}
