import type {
  Campaign,
  CampaignEnrollment,
  CampaignStep,
  Company,
  Conversion,
  Customer,
  Message,
  Plan,
  Subscription,
  SuppressionEntry,
  Vehicle,
  Visit,
} from "./types";

/** The in-memory database: one array per Phase 1 table. */
export interface DemoDatabase {
  companies: Company[];
  customers: Customer[];
  vehicles: Vehicle[];
  visits: Visit[];
  campaigns: Campaign[];
  campaign_steps: CampaignStep[];
  campaign_enrollments: CampaignEnrollment[];
  messages: Message[];
  conversions: Conversion[];
  plans: Plan[];
  subscriptions: Subscription[];
  suppression_list: SuppressionEntry[];
  seeded_at: string;
  /** The shop the presentation walkthrough is built around. */
  primary_company_id: string | null;
  version: number;
}

export function emptyDatabase(now: Date): DemoDatabase {
  return {
    companies: [],
    customers: [],
    vehicles: [],
    visits: [],
    campaigns: [],
    campaign_steps: [],
    campaign_enrollments: [],
    messages: [],
    conversions: [],
    plans: [],
    subscriptions: [],
    suppression_list: [],
    seeded_at: now.toISOString(),
    primary_company_id: null,
    version: 0,
  };
}
