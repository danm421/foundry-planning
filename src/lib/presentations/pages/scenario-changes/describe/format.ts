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
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? humanizeField(field);
}

export function fmtValue(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") {
    if (Number.isInteger(v) && v > 1900 && v < 2200) return String(v); // year-shaped
    if (Math.abs(v) >= 1000) return compactCurrency(v);
    return String(v);
  }
  return String(v);
}
