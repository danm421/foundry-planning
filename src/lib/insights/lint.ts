export const STALE_VALUATION_DAYS = 180;
export const NO_CONTACT_DAYS = 90;

export type LintFinding = {
  kind: "overdue_task" | "stale_valuation" | "no_contact";
  message: string;
};

export interface LintInput {
  overdueTaskCount: number;
  lastContactAt: Date | null;
  oldestAccountValuationAt: Date | null;
}

const daysBetween = (a: Date, b: Date): number =>
  Math.floor((a.getTime() - b.getTime()) / 86_400_000);

export function computeNeedsAttention(
  input: LintInput,
  today: Date,
): LintFinding[] {
  const out: LintFinding[] = [];

  if (input.overdueTaskCount > 0) {
    out.push({
      kind: "overdue_task",
      message: `${input.overdueTaskCount} overdue task${input.overdueTaskCount === 1 ? "" : "s"}`,
    });
  }

  if (
    input.oldestAccountValuationAt &&
    daysBetween(today, input.oldestAccountValuationAt) > STALE_VALUATION_DAYS
  ) {
    out.push({
      kind: "stale_valuation",
      message: `Account values not updated in over ${STALE_VALUATION_DAYS} days`,
    });
  }

  if (
    !input.lastContactAt ||
    daysBetween(today, input.lastContactAt) > NO_CONTACT_DAYS
  ) {
    out.push({
      kind: "no_contact",
      message: `No logged contact in over ${NO_CONTACT_DAYS} days`,
    });
  }

  return out;
}
