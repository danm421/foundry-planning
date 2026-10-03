import type { ClientInfo, StressTestKind, StressTestParams } from "@/engine/types";
import { ltcPersonFirstName } from "@/lib/ltc/ltc-event-name";

/** The Stress tab's row labels. A saved change's title starts with the words
 *  the advisor clicked. */
export const STRESS_TEST_LABELS: Record<StressTestKind, string> = {
  inflation: "Higher inflation",
  "ss-haircut": "Social Security cut",
  "tax-rates": "Tax rates rise",
  disability: "Disability",
  "market-crash": "Market crash",
  "exemption-cap": "Cap exemption growth",
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** decimal → "23%" / "3.5%" — at most two decimals, never "0.35000000000000003". */
function pct(d: number): string {
  return `${Number((d * 100).toFixed(2))}%`;
}

function points(d: number): string {
  const n = Number((d * 100).toFixed(2));
  return `${n} ${n === 1 ? "point" : "points"}`;
}

function disabledSpan(start: number, end: number | null): string {
  if (end == null) return `from ${start}`;
  return end === start ? `in ${start}` : `${start}–${end}`;
}

/** The change's title on the Changes tab and the Plan Changes page. Written
 *  onto the entity at save time, the way an LTC event's name is. */
export function stressTestName(t: StressTestParams, client: ClientInfo): string {
  const label = STRESS_TEST_LABELS[t.kind];
  switch (t.kind) {
    case "inflation":
      return `${label} — ${pct(t.rate)} a year`;
    case "ss-haircut":
      return `${label} — ${pct(t.pct)} from ${t.startYear}`;
    case "tax-rates":
      return `${label} — ${points(t.points)} from ${t.startYear}`;
    case "disability":
      return `${label} — ${ltcPersonFirstName(t.person, client)} ${disabledSpan(t.startYear, t.endYear)}`;
    case "market-crash":
      return `${label} — ${pct(t.drawdownPct)} in ${t.year}`;
    case "exemption-cap":
      return `${label} — ${money.format(t.cap)}`;
  }
}

/** One plain-words line for the Plan Changes presentation page. */
export function stressTestDetail(t: StressTestParams): string {
  switch (t.kind) {
    case "inflation":
      return `Living expenses grow ${pct(t.rate)} a year`;
    case "ss-haircut":
      return `Social Security benefits cut ${pct(t.pct)} from ${t.startYear}`;
    case "tax-rates":
      return `Federal tax rates up ${points(t.points)} from ${t.startYear}`;
    case "disability":
      if (t.endYear == null) return `Disabled from ${t.startYear}`;
      return t.endYear === t.startYear
        ? `Disabled in ${t.startYear}`
        : `Disabled ${t.startYear} through ${t.endYear}`;
    case "market-crash":
      return `Investments drop ${pct(t.drawdownPct)} in ${t.year}`;
    case "exemption-cap":
      return `Estate exemption capped at ${money.format(t.cap)}`;
  }
}
