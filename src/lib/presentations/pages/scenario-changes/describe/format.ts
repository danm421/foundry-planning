import { compactCurrency } from "@/lib/presentations/format";

export function nameFor(
  c: { targetKind: string; targetId: string },
  names: Record<string, string>,
): string | null {
  return names[`${c.targetKind}:${c.targetId}`] ?? null;
}

export function humanizeField(field: string): string {
  const spaced = field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

const FIELD_LABELS: Record<string, string> = {
  retirementAge: "Retirement age",
  lifeExpectancy: "Life expectancy",
  claimAge: "Social Security claim age",
  ssClaimAge: "Social Security claim age",
  amount: "Amount",
  monthlyAmount: "Monthly amount",
  annualAmount: "Annual amount",
  startYear: "Start year",
  endYear: "End year",
  growthRate: "Growth rate",
  balance: "Balance",
  percentage: "Percentage",
  rate: "Rate",
  salaryBasis: "Salary basis",
  salaryIncomeIds: "Salaries used",
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? humanizeField(field);
}

export function fmtValue(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") {
    if (Number.isInteger(v) && v >= 2001 && v < 2200) return String(v); // year-shaped
    if (Math.abs(v) >= 1000) return compactCurrency(v);
    return String(v);
  }
  /**
   * A payload field that is not a scalar.
   *
   * `String(v)` on an `owners` array yields "[object Object],[object Object]",
   * and that string reached a CLIENT PAGE — seen on the Warner household
   * 2026-08-12, on six of seven Plan Story strategy cards, and equally on this
   * page's own Scenario Changes table, which is where it has always been. There
   * is no rendering of an owner slice that belongs in a diff cell, so the honest
   * answer is the same em dash every other unprintable value gets: the change is
   * still listed, its name is still right, and only the before/after pair is
   * withheld.
   *
   * An array of strings is a real case (a list of names) and keeps working.
   */
  if (Array.isArray(v)) {
    return v.every((item) => typeof item === "string" || typeof item === "number")
      ? v.join(", ")
      : "—";
  }
  if (typeof v === "object") return "—";
  return String(v);
}
