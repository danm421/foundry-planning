import type { ClientData, ProjectionYear } from "@/engine";
import type { TimelineEvent } from "./timeline-types";
import { CATEGORY_PRIORITY } from "./timeline-types";
import { detectLifeEvents } from "./detectors/life";
import { detectIncomeEvents } from "./detectors/income";
import { detectTransactionEvents } from "./detectors/transactions";
import { detectPortfolioEvents, DEFAULT_PORTFOLIO_THRESHOLDS } from "./detectors/portfolio";
import { detectInsuranceEvents } from "./detectors/insurance";
import { detectTaxEvents } from "./detectors/tax";

const SUBJECT_PRIORITY = { primary: 0, spouse: 1, joint: 2 } as const;

// Within category=life, events sort by kind so the biggest milestone (Retirement)
// leads the year. Kinds are parsed from the id prefix `life:<kind>:...`. Unknown
// kinds fall back to the max priority so they sort after the known ones, then
// by id.
const LIFE_KIND_PRIORITY: Record<string, number> = {
  retire: 0,
  ss_claim: 1,
  ss_fra: 2,
  medicare: 3,
  death: 4,
};

function lifeKindPriority(id: string): number {
  const kind = id.split(":")[1] ?? "";
  return LIFE_KIND_PRIORITY[kind] ?? 99;
}

/**
 * When SS-claim fires as a Life event for a subject, it pre-empts any
 * `income:ss_begin:*` for the same subject (Life wins). We key on subject
 * because the Life detector derives the claim year from `claimingAge`+DOB
 * while the Income detector uses `startYear`, and real-world inputs may have
 * these two sources disagree on the calendar year.
 */
function ssCollisionSubjects(events: TimelineEvent[]): Set<string> {
  const subjects = new Set<string>();
  for (const e of events) {
    if (e.category === "life" && e.id.startsWith("life:ss_claim:")) {
      subjects.add(e.subject);
    }
  }
  return subjects;
}

export function buildTimeline(
  data: ClientData,
  projection: ProjectionYear[],
): TimelineEvent[] {
  if (projection.length === 0) return [];

  const raw: TimelineEvent[] = [
    ...detectLifeEvents(data, projection),
    ...detectIncomeEvents(data, projection),
    ...detectTransactionEvents(data, projection),
    ...detectPortfolioEvents(data, projection, DEFAULT_PORTFOLIO_THRESHOLDS),
    ...detectInsuranceEvents(data, projection),
    ...detectTaxEvents(data, projection),
  ];

  const ssCollisionSubjectSet = ssCollisionSubjects(raw);

  // Also collapse multiple Income ss_begin events for the same subject down to one
  // (e.g., spouse has both a retirement benefit and a spousal benefit entered as two
  // separate incomes, or the advisor created two rows by mistake). Pick the earliest
  // start year — deterministic via the pre-sort below.
  const ssBeginByEarliestYear = new Map<string, number>();
  for (const e of raw) {
    if (e.category === "income" && e.id.startsWith("income:ss_begin:")) {
      const prev = ssBeginByEarliestYear.get(e.subject);
      if (prev == null || e.year < prev) ssBeginByEarliestYear.set(e.subject, e.year);
    }
  }
  const ssBeginSeenSubjects = new Set<string>();

  const filtered = raw.filter((e) => {
    if (e.category === "income" && e.id.startsWith("income:ss_begin:")) {
      // Life ss_claim for same subject preempts every income ss_begin.
      if (ssCollisionSubjectSet.has(e.subject)) return false;
      // Keep only the earliest-year ss_begin per subject; drop any later or tied duplicates.
      if (e.year !== ssBeginByEarliestYear.get(e.subject)) return false;
      if (ssBeginSeenSubjects.has(e.subject)) return false;
      ssBeginSeenSubjects.add(e.subject);
    }
    return true;
  });

  // Deterministic sort: year asc, then category priority, then subject, then id.
  filtered.sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    const ca = CATEGORY_PRIORITY[a.category];
    const cb = CATEGORY_PRIORITY[b.category];
    if (ca !== cb) return ca - cb;
    if (a.category === "life" && b.category === "life") {
      const ka = lifeKindPriority(a.id);
      const kb = lifeKindPriority(b.id);
      if (ka !== kb) return ka - kb;
    }
    const sa = SUBJECT_PRIORITY[a.subject];
    const sb = SUBJECT_PRIORITY[b.subject];
    if (sa !== sb) return sa - sb;
    return a.id.localeCompare(b.id);
  });

  return filtered;
}
