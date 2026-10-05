import { addDays, fromDateOnly } from "../domain/dates";
import { customerStatus, statusFromLastVisit, type VisitStatus } from "../domain/lifecycle";
import type { CompanyIndex } from "./company-index";
import type { Customer } from "./types";

/**
 * Recomputes the derived columns of one customer and their vehicles
 * (last_visit_at, visit_count, lifetime value, lifecycle status). Phase 1
 * runs this as the nightly / post-import lifecycle job.
 */
export function recomputeCustomer(index: CompanyIndex, customer: Customer, now: Date) {
  const thresholds = index.company.settings.lifecycle;
  const visits = index.visitsByCustomer.get(customer.id) ?? [];
  const vehicles = index.vehiclesByCustomer.get(customer.id) ?? [];

  const statuses: VisitStatus[] = [];
  for (const vehicle of vehicles) {
    const vv = index.visitsByVehicle.get(vehicle.id) ?? [];
    vehicle.last_visit_at = vv.length ? vv[vv.length - 1].visited_at : null;
    const status = statusFromLastVisit(
      vehicle.last_visit_at ? fromDateOnly(vehicle.last_visit_at) : null,
      now,
      thresholds,
    );
    vehicle.lifecycle_status = status;
    statuses.push(status);
  }

  customer.last_visit_at = visits.length ? visits[visits.length - 1].visited_at : null;
  customer.visit_count = visits.length;
  customer.lifetime_value_minor = visits.reduce((sum, v) => sum + (v.job_value_minor ?? 0), 0);
  if (vehicles.length === 0) {
    statuses.push(
      statusFromLastVisit(customer.last_visit_at ? fromDateOnly(customer.last_visit_at) : null, now, thresholds),
    );
  }

  const yearAgo = addDays(now, -365).getTime();
  const reactivated = (index.enrollmentsByCustomer.get(customer.id) ?? []).some((e) => {
    const conversion = index.conversionByEnrollment.get(e.id);
    return (
      conversion?.stage === "completed" &&
      !conversion.is_holdout &&
      conversion.completed_at !== null &&
      new Date(conversion.completed_at).getTime() >= yearAgo
    );
  });

  const suppressed = index.suppressedCustomerIds.has(customer.id);
  customer.lifecycle_status = customerStatus({ visitStatuses: statuses, suppressed, reactivated });
  if (suppressed) for (const v of vehicles) v.lifecycle_status = "opted_out";
}
