/**
 * Campaign builder numbers (spec §12 "Campaign builder numbers"). Expected
 * revenue uses a conservative conversion rate; the 100 % "maximum" is only
 * secondary text (spec §0.10).
 */

export interface CampaignEstimate {
  eligible: number;
  holdout: number;
  sendCount: number;
  expectedRevenueMinor: number;
  maxPotentialMinor: number;
}

export function estimateCampaign(input: {
  eligible: number;
  holdoutPct: number;
  conversionRate: number;
  avgJobValueMinor: number;
}): CampaignEstimate {
  const holdout = Math.round(input.eligible * input.holdoutPct);
  const sendCount = input.eligible - holdout;
  return {
    eligible: input.eligible,
    holdout,
    sendCount,
    expectedRevenueMinor: Math.round(sendCount * input.conversionRate * input.avgJobValueMinor),
    maxPotentialMinor: sendCount * input.avgJobValueMinor,
  };
}

/** Shop's historical median for the segment's categories if ≥ 20 visits exist, else the company average. */
export function averageJobValue(values: number[], fallbackMinor: number): number {
  if (values.length < 20) return fallbackMinor;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Small deterministic PRNG so holdout selection is reproducible per campaign. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Random holdout of round(n × pct) ids, seeded by the campaign id (spec §12). */
export function selectHoldout(ids: string[], pct: number, campaignId: string): Set<string> {
  const rand = mulberry32(hashString(campaignId));
  const shuffled = [...ids];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return new Set(shuffled.slice(0, Math.round(ids.length * pct)));
}
