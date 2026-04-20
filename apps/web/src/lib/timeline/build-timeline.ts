import type { ClientData, ProjectionYear } from "@foundry/engine";
import type { TimelineEvent } from "./timeline-types";
import { CATEGORY_PRIORITY } from "./timeline-types";
import { detectLifeEvents } from "./detectors/life";
import { detectIncomeEvents } from "./detectors/income";
import { detectTransactionEvents } from "./detectors/transactions";
import { detectPortfolioEvents, DEFAULT_PORTFOLIO_THRESHOLDS } from "./detectors/portfolio";
import { detectInsuranceEvents } from "./detectors/insurance";
import { detectTaxEvents } from "./detectors/tax";

const SUBJECT_PRIORITY = { primary: 0, spouse: 1, joint: 2 } as const;

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

  const filtered = raw.filter((e) => {
    // Drop Income ss_begin events for any subject that already has a Life ss_claim event.
    if (e.category === "income" && e.id.startsWith("income:ss_begin:")) {
      if (ssCollisionSubjectSet.has(e.subject)) return false;
    }
    return true;
  });

  // Deterministic sort: year asc, then category priority, then subject, then id.
  filtered.sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    const ca = CATEGORY_PRIORITY[a.category];
    const cb = CATEGORY_PRIORITY[b.category];
    if (ca !== cb) return ca - cb;
    const sa = SUBJECT_PRIORITY[a.subject];
    const sb = SUBJECT_PRIORITY[b.subject];
    if (sa !== sb) return sa - sb;
    return a.id.localeCompare(b.id);
  });

  return filtered;
}
