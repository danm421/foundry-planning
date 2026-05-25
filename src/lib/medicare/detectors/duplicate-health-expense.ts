import type { MedicareDetector } from "./types";

const HEALTH_NAME_PATTERN = /health|medical|insurance|medicare|medigap|supplement/i;

export const duplicateHealthExpense: MedicareDetector = ({ expenses, medicareCoverage }) => {
  const enrollmentYears = medicareCoverage
    .map(c => c.enrollmentYear)
    .filter((y): y is number => y !== null);
  if (enrollmentYears.length === 0) return null;
  const earliestEnrollment = Math.min(...enrollmentYears);

  const offenders = expenses.filter(e =>
    HEALTH_NAME_PATTERN.test(e.name) &&
    e.endsAtMedicareEligibilityOwner === null &&
    e.endYear >= earliestEnrollment &&
    e.annualAmount > 0,
  );

  if (offenders.length === 0) return null;
  const worst = offenders[0]!;

  return {
    id: "duplicate-expense",
    severity: "warning",
    title: "Possible duplicate health expense",
    body: `"${worst.name}" expense ($${worst.annualAmount.toLocaleString()}/yr) continues past ${earliestEnrollment} (Medicare enrollment). Medicare premiums are now auto-projected — mark this expense as pre-Medicare or remove it to avoid double-counting.`,
    impactedYears: [earliestEnrollment],
    action: { label: "Mark as pre-Medicare", href: `#expense-${worst.id}` },
  };
};
