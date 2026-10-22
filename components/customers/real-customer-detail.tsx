import { Car } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { LifecycleBadge } from "@/components/common/badges";
import { ContactEditDialog } from "@/components/customers/contact-edit-dialog";
import { VisitTimeline } from "@/components/customers/customer-detail";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RealCustomerDetail as Detail } from "@/lib/db/supabase/customers";
import { formatDate } from "@/lib/domain/dates";
import { formatCZK, formatInt } from "@/lib/domain/money";
import { formatPhone } from "@/lib/domain/phone";

/**
 * One screen per customer on real data (spec §8 "Zákazník – detail"):
 * contact and eligibility, vehicles with their visit timeline, notes.
 * Campaign history and the conversion pipeline join with slices 10 and 14.
 */
export async function RealCustomerDetail({
  data,
  backHref,
  canEdit,
}: {
  data: Detail;
  backHref: string;
  canEdit: boolean;
}) {
  const t = await getTranslations("customer");
  const tLegal = await getTranslations("legalBasis");
  const tPhone = await getTranslations("phoneType");
  const tExcl = await getTranslations("exclusions");
  const c = data.customer;

  return (
    <>
      <PageHeader
        back={{ href: backHref, label: t("back") }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {c.name} <LifecycleBadge status={c.status} />
          </span>
        }
        description={c.externalId ? `ID ${c.externalId}` : undefined}
        actions={
          canEdit ? (
            <ContactEditDialog
              companyId={c.companyId}
              customerId={c.id}
              defaults={{
                first_name: c.firstName ?? "",
                last_name: c.lastName ?? "",
                phone: c.phone ? formatPhone(c.phone) : "",
                email: c.email ?? "",
                notes: c.notes ?? "",
              }}
            />
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("vehicles")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {data.vehicles.length === 0 && data.looseVisits.length === 0 && (
                <p className="text-sm text-muted">{t("noHistory")}</p>
              )}
              {data.vehicles.map((v) => (
                <div key={v.id} data-testid="vehicle">
                  <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Car className="size-4 text-muted" aria-hidden />
                    <span className="font-medium text-ink">{[v.brand, v.model].filter(Boolean).join(" ") || "—"}</span>
                    {v.plate && (
                      <Badge tone="outline" className="font-mono">
                        {v.plate}
                      </Badge>
                    )}
                    <LifecycleBadge status={v.status} />
                    {(v.modelYear || v.vin) && (
                      <span className="text-[12px] text-muted">
                        {v.modelYear && (
                          <>
                            {t("year")} {v.modelYear}
                          </>
                        )}
                        {v.vin && (
                          <>
                            {v.modelYear && " · "}
                            {t("vin")} <span className="font-mono">{v.vin}</span>
                          </>
                        )}
                      </span>
                    )}
                  </div>
                  {v.visits.length ? (
                    <VisitTimeline visits={v.visits} />
                  ) : (
                    <p className="text-sm text-muted">{t("noVisits")}</p>
                  )}
                </div>
              ))}
              {data.looseVisits.length > 0 && (
                <div>
                  <p className="mb-3 text-sm text-muted">{t("noVehicle")}</p>
                  <VisitTimeline visits={data.looseVisits} />
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("campaigns")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted">{t("noCampaigns")}</p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("contact")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-[12px] text-muted">{t("phone")}</dt>
                  <dd className="tnum text-ink" data-testid="customer-phone">
                    {c.phone ? formatPhone(c.phone) : "—"}{" "}
                    {c.phone && <span className="text-[12px] text-muted">({tPhone(c.phoneType)})</span>}
                  </dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted">{t("email")}</dt>
                  <dd className="break-all text-ink">{c.email ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted">{t("legalBasis")}</dt>
                  <dd className="text-ink">
                    {tLegal(c.legalBasis)}
                    {c.legalBasisRecordedAt && (
                      <span className="block text-[12px] text-muted">
                        {t("legalBasisRecorded", { date: formatDate(c.legalBasisRecordedAt) })}
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted">{t("eligibility")}</dt>
                  <dd data-testid="customer-eligibility">
                    {data.eligibility ? (
                      <Badge tone="outline">{t("notEligible", { reason: tExcl(data.eligibility) })}</Badge>
                    ) : (
                      <Badge tone="accent">{t("eligible")}</Badge>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted">{t("notes")}</dt>
                  <dd className="whitespace-pre-line text-ink-2">{c.notes ?? "—"}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("summary")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-[12px] text-muted">{t("lifetime")}</dt>
                  <dd className="tnum font-semibold text-ink">{formatCZK(c.lifetimeValueMinor)}</dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted">{t("visitsCount")}</dt>
                  <dd className="tnum font-semibold text-ink">{formatInt(c.visitCount)}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[12px] text-muted">{t("lastVisit")}</dt>
                  <dd className="tnum text-ink">{c.lastVisitAt ? formatDate(c.lastVisitAt) : "—"}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
