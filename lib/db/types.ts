/**
 * Row types mirroring the Phase 1 Postgres schema (spec §18). Field names,
 * enums and units (money in haléře as *_minor, dates as ISO strings) match the
 * SQL so Phase 1 can swap the in-memory store for Supabase without touching
 * pages or domain logic. Only the tables Phase 0 needs are modelled.
 */

export type CompanyRole = "shop_owner" | "shop_manager";
export type ServiceMode = "managed" | "self_service";
export type LegalBasis = "consent" | "existing_customer" | "unknown";
export type LifecycleStatus = "active" | "at_risk" | "inactive" | "reactivated" | "opted_out";
export type ServiceCategory =
  | "regular_service"
  | "oil_change"
  | "tyre_change"
  | "tyre_storage"
  | "ac_service"
  | "brakes"
  | "diagnostics"
  | "stk"
  | "repair_other";
export type CampaignStatus =
  | "draft"
  | "waiting_for_approval"
  | "scheduled"
  | "sending"
  | "active"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";
export type MessageStatus =
  "queued" | "sending" | "sent" | "delivered" | "undelivered" | "expired" | "failed" | "cancelled";
export type ConversionStage = "contacted" | "replied" | "booked" | "completed" | "lost" | "opted_out";
export type ConversionSource = "manual_confirmed" | "import_matched" | "manual_unverified";
export type CompanyStatus = "onboarding" | "active" | "paused" | "offboarding" | "closed";
export type PhoneType = "mobile" | "fixed" | "unknown";

/** ISO 8601 instant, e.g. 2026-10-05T09:30:00.000Z (timestamptz). */
export type Timestamp = string;
/** Calendar date, e.g. 2026-10-05 (date). */
export type DateOnly = string;

export interface CompanySettings {
  lifecycle: { active_max_months: number; at_risk_max_months: number };
  max_lookback_months: number;
  attribution_window_days: number;
  holdout_pct: number;
  expected_conversion_rate: number;
  /** Optional gross margin (0–1) to show profit ROI next to revenue ROI (spec §0). */
  gross_margin_pct: number | null;
  /** Shop name as written inside SMS bodies ({{servis}}). */
  message_shop_name: string | null;
}

export interface Company {
  id: string;
  name: string;
  ico: string | null;
  dic: string | null;
  address_line: string | null;
  city: string | null;
  postal_code: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  contact_person: string | null;
  timezone: string;
  average_job_value_minor: number;
  default_sender_name: string | null;
  service_mode: ServiceMode;
  requires_client_approval: boolean;
  settings: CompanySettings;
  sending_enabled: boolean;
  dpa_signed_at: Timestamp | null;
  status: CompanyStatus;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Customer {
  id: string;
  company_id: string;
  external_id: string | null;
  first_name: string | null;
  last_name: string | null;
  phone_e164: string | null;
  phone_type: PhoneType;
  email: string | null;
  legal_basis: LegalBasis;
  lifecycle_status: LifecycleStatus;
  last_visit_at: DateOnly | null;
  visit_count: number;
  lifetime_value_minor: number;
  notes: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Vehicle {
  id: string;
  company_id: string;
  customer_id: string;
  brand: string | null;
  model: string | null;
  model_year: number | null;
  license_plate_display: string | null;
  license_plate_norm: string | null;
  vin: string | null;
  last_visit_at: DateOnly | null;
  lifecycle_status: LifecycleStatus;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Visit {
  id: string;
  company_id: string;
  customer_id: string;
  vehicle_id: string | null;
  visited_at: DateOnly;
  service_type_raw: string | null;
  service_category: ServiceCategory;
  job_value_minor: number | null;
  created_at: Timestamp;
}

export interface Campaign {
  id: string;
  company_id: string;
  name: string;
  segment_preset: string | null;
  segment_rules_snapshot: unknown;
  channel: "sms";
  status: CampaignStatus;
  scheduled_at: Timestamp | null;
  holdout_pct: number;
  offer_text: string | null;
  automation_rule_id: string | null;
  expected_conversion_rate: number;
  avg_job_value_minor_snapshot: number | null;
  attribution_window_days: number;
  approved_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  completed_at: Timestamp | null;
}

export interface CampaignStep {
  id: string;
  company_id: string;
  campaign_id: string;
  step_number: number;
  delay_days: number;
  body_template: string;
  strip_diacritics: boolean;
  created_at: Timestamp;
}

export interface CampaignEnrollment {
  id: string;
  company_id: string;
  campaign_id: string;
  customer_id: string;
  vehicle_id: string | null;
  is_holdout: boolean;
  stage: ConversionStage;
  stopped_reason: string | null;
  first_sent_at: Timestamp | null;
  window_ends_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Message {
  id: string;
  company_id: string;
  campaign_id: string;
  enrollment_id: string;
  step_id: string;
  customer_id: string;
  channel: "sms";
  to_address: string;
  body_rendered: string;
  encoding: "GSM-7" | "UCS-2";
  segments: number;
  status: MessageStatus;
  provider_id: string | null;
  provider_message_id: string | null;
  idempotency_key: string;
  cost_minor: number | null;
  error_code: string | null;
  attempts: number;
  queued_at: Timestamp;
  sent_at: Timestamp | null;
  delivered_at: Timestamp | null;
  failed_at: Timestamp | null;
}

export interface Conversion {
  id: string;
  company_id: string;
  enrollment_id: string;
  campaign_id: string;
  customer_id: string;
  vehicle_id: string | null;
  stage: ConversionStage;
  source: ConversionSource;
  is_holdout: boolean;
  booked_at: Timestamp | null;
  completed_at: Timestamp | null;
  revenue_minor: number | null;
  visit_id: string | null;
  confirmed_at: Timestamp | null;
  notes: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Plan {
  id: string;
  key: string;
  name: string;
  price_minor: number;
}

export interface Subscription {
  id: string;
  company_id: string;
  plan_id: string;
  price_override_minor: number | null;
  status: "trial" | "active" | "past_due" | "cancelled";
  current_period_start: DateOnly;
  created_at: Timestamp;
}

export interface SuppressionEntry {
  id: string;
  company_id: string;
  channel: "sms" | "email";
  /** Phase 1: HMAC-SHA256 with a server-side pepper. Phase 0: plain SHA-256. */
  address_hash: string;
  reason: "opt_out_link" | "keyword" | "manual" | "erasure" | "bounce" | "complaint";
  created_at: Timestamp;
}

export interface PlatformAdmin {
  user_id: string;
  created_at: Timestamp;
}

export interface Profile {
  user_id: string;
  full_name: string | null;
  locale: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Membership {
  id: string;
  user_id: string;
  company_id: string;
  role: CompanyRole;
  created_at: Timestamp;
}

export interface Invitation {
  id: string;
  company_id: string;
  email: string;
  role: CompanyRole;
  token_hash: string;
  expires_at: Timestamp;
  accepted_at: Timestamp | null;
  invited_by: string | null;
  created_at: Timestamp;
}

export interface ServiceCategoryMapping {
  id: string;
  company_id: string;
  raw_value_norm: string;
  category: ServiceCategory;
  created_by: string | null;
  created_at: Timestamp;
}

export interface AuditLog {
  id: number;
  company_id: string | null;
  actor_user_id: string | null;
  actor_type: "user" | "admin" | "system";
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  user_agent: string | null;
  created_at: Timestamp;
}
