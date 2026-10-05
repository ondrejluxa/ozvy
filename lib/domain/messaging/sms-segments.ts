/**
 * SMS segment counting (spec §0.6, §16). One character outside the GSM-7
 * alphabet switches the whole message to UCS-2: 70 chars for a single SMS
 * and 67 per segment when concatenated, versus 160 / 153 in GSM-7.
 */

const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡" +
  "ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
// Extension characters cost two septets (escape + char).
const GSM7_EXTENDED = "^{}\\[~]|€\f";

const basic = new Set(GSM7_BASIC);
const extended = new Set(GSM7_EXTENDED);

export type SmsEncoding = "GSM-7" | "UCS-2";

export interface SegmentInfo {
  encoding: SmsEncoding;
  /** Length in encoding units (septets for GSM-7, UTF-16 code units for UCS-2). */
  units: number;
  segments: number;
  /** Capacity per segment for the current length. */
  perSegment: number;
  /** Units left before the next segment starts. */
  remaining: number;
  /** Characters that forced UCS-2, deduplicated (for the editor hint). */
  nonGsmChars: string[];
}

export function countSmsSegments(text: string): SegmentInfo {
  let septets = 0;
  const nonGsm = new Set<string>();
  for (const ch of text) {
    if (basic.has(ch)) septets += 1;
    else if (extended.has(ch)) septets += 2;
    else nonGsm.add(ch);
  }

  if (nonGsm.size === 0) {
    const single = 160;
    const multi = 153;
    const segments = septets === 0 ? 0 : septets <= single ? 1 : Math.ceil(septets / multi);
    const perSegment = segments <= 1 ? single : multi;
    return {
      encoding: "GSM-7",
      units: septets,
      segments,
      perSegment,
      remaining: Math.max(0, (segments || 1) * perSegment - septets),
      nonGsmChars: [],
    };
  }

  // UCS-2 counts UTF-16 code units; emoji take two.
  const units = text.length;
  const single = 70;
  const multi = 67;
  const segments = units <= single ? 1 : Math.ceil(units / multi);
  const perSegment = segments <= 1 ? single : multi;
  return {
    encoding: "UCS-2",
    units,
    segments,
    perSegment,
    remaining: Math.max(0, segments * perSegment - units),
    nonGsmChars: [...nonGsm],
  };
}
