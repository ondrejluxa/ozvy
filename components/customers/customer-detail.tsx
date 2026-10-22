import { Car, MessageSquareText } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LifecycleBadge, MessageStatusBadge, StageBadge } from "@/components/common/badges";
import { ConversionActions } from "@/components/customers/conversion-actions";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { getCustomerDetail } from "@/lib/db/queries";
import type { Visit } from "@/lib/db/types";
import { formatDate } from "@/lib/domain/dates";
import { formatCZK, formatInt } from "@/lib/domain/money";

type Detail = NonNullable<ReturnType<typeof getCustomerDetail>>;

export async function VisitTimeline({
  visits,
}: {
  visits: Pick<Visit, "id" | "visited_at" | "service_type_raw" | "service_category" | "job_value_minor">[];
}) {
  const tCategory = await getTranslations("category");
  const t = await getTranslations("customer");
  return (
    <ol className="relative ml-1.5 border-l border-line">
      {visits.map((v) => (
        <li key={v.id} className="relative pb-3 pl-4 last:pb-0">
          <span className="absolute -left-[4.5px] top-1.5 size-2 rounded-full bg-line-strong" aria-hidden />
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-sm text-ink">
              <span className="tnum text-muted">{formatDate(v.visited_at)}</span> · {v.service_type_raw}
            </span>
            <span className="tnum text-sm text-ink-2">
              {v.job_value_minor !== null ? formatCZK(v.job_value_minor) : t("noValue")}
            </span>
          </div>
          <span className="text-[12px] text-faint">{tCategory(v.service_category)}</span>
        </li>
      ))}
    </ol>
  );
}

/** One screen per customer (spec §8): contact, eligibility, vehicles with visit timeline, campaigns, pipeline. */
export async function CustomerDetail({
  data,
  backHref,
  campaignHref,
  readOnly,
}: {
  data: Detail;
  backHref: string;
  campaignHref: (campaignId: string) => string;
  readOnly: boolean;
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
            {data.name} <LifecycleBadge status={c.lifecycle_status} />
          </span>
        }
        description={c.external_id ? `ID ${c.external_id}` : undefined}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("campaigns")}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.enrollments.length === 0 ? (
                <p className="text-sm text-muted">{t("noCampaigns")}</p>
              ) : (
                <ul className="space-y-4">
                  {data.enrollments.map((e) => (
                    <li key={e.id} className="rounded-md border border-line p-3.5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 text-sm">
                          <p className="text-ink">
                            {e.isHoldout
                              ? t("holdoutIn")
                              : t("contactedIn", { date: e.firstSentAt ? formatDate(e.firstSentAt) : "—" })}
                          </p>
                          <Link href={campaignHref(e.campaignId)} className="font-medium text-accent hover:underline">
                            {e.campaignName}
                          </Link>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <StageBadge stage={e.stage} />
                            {e.messageStatus && <MessageStatusBadge status={e.messageStatus} />}
                            {e.revenueMinor !== null && (
                              <span className="tnum text-sm font-semibold text-accent">
                                {formatCZK(e.revenueMinor)}
                              </span>
                            )}
                          </div>
                        </div>
                        {!readOnly && (e.windowOpen || e.stage === "booked" || e.stage === "completed") && (
                          <ConversionActions
                            companyId={data.company.id}
                            enrollmentId={e.id}
                            stage={e.stage}
                            isHoldout={e.isHoldout}
                            customerName={data.name}
                            campaignName={e.campaignName}
                            revenueMinor={e.revenueMinor}
                            compact
                          />
                        )}
                      </div>
                      {e.messageBody && (
                        <div className="mt-3 flex gap-2 rounded-md bg-subtle px-3 py-2 text-[13px] leading-5 text-ink-2">
                          <MessageSquareText className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                          <span>{e.messageBody}</span>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("vehicles")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {data.vehicles.map(({ vehicle, visits }) => (
                <div key={vehicle.id}>
                  <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Car className="size-4 text-muted" aria-hidden />
                    <span className="font-medium text-ink">
                      {vehicle.brand} {vehicle.model}
                    </span>
                    <Badge tone="outline" className="font-mono">
                      {vehicle.license_plate_display}
                    </Badge>
                    <LifecycleBadge status={vehicle.lifecycle_status} />
                    <span className="text-[12px] text-muted">
                      {t("year")} {vehicle.model_year}
                      {vehicle.vin && (
                        <>
                          {" "}
                          · {t("vin")} <span className="font-mono">{vehicle.vin}</span>
                        </>
                      )}
                    </span>
                  </div>
                  <VisitTimeline visits={visits} />
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
                  <dd className="tnum text-ink">
                    {data.phone} <span className="text-[12px] text-muted">({tPhone(c.phone_type)})</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted">{t("email")}</dt>
                  <dd className="break-all text-ink">{c.email ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted">{t("legalBasis")}</dt>
                  <dd className="text-ink">{tLegal(c.legal_basis)}</dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted">{t("eligibility")}</dt>
                  <dd>
                    {data.eligibilityReason ? (
                      <Badge tone="outline">{t("notEligible", { reason: tExcl(data.eligibilityReason) })}</Badge>
                    ) : (
                      <Badge tone="accent">{t("eligible")}</Badge>
                    )}
                  </dd>
                </div>
                {c.notes && (
                  <div>
                    <dt className="text-[12px] text-muted">{t("notes")}</dt>
                    <dd className="text-ink-2">{c.notes}</dd>
                  </div>
                )}
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
                  <dd className="tnum font-semibold text-ink">{formatCZK(c.lifetime_value_minor)}</dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted">{t("visitsCount")}</dt>
                  <dd className="tnum font-semibold text-ink">{formatInt(c.visit_count)}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[12px] text-muted">{t("lastVisit")}</dt>
                  <dd className="tnum text-ink">{c.last_visit_at ? formatDate(c.last_visit_at) : "—"}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
