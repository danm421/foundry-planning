import { compactCurrency } from "@/lib/presentations/format";
import { YEAR_REF_LABELS, type YearRef } from "@/lib/milestones";

export const toNum = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : null;
};

export function money(v: unknown): string {
  const n = toNum(v);
  return n == null ? "—" : compactCurrency(n);
}

/** 0–1 fraction → whole/one-decimal percent. */
export function pct(v: unknown): string {
  const n = toNum(v);
  if (n == null) return "—";
  const p = n * 100;
  return Number.isInteger(p) ? `${p}%` : `${p.toFixed(1)}%`;
}

/** Resolved concrete year, annotated with its milestone label when a ref is set. */
export function yearWithRef(year: number | null | undefined, ref: string | null | undefined): string {
  if (year == null) return "—";
  const label = ref && ref in YEAR_REF_LABELS ? YEAR_REF_LABELS[ref as YearRef] : null;
  return label ? `${year} (${label})` : String(year);
}

export function joinSegments(parts: Array<string | null | undefined>, sep = " · "): string {
  return parts.filter((p): p is string => !!p && p.length > 0).join(sep);
}

export const ENUM_LABELS = {
  conversionType: {
    fixed_amount: "Fixed amount", full_account: "Full account",
    deplete_over_period: "Deplete over period", fill_up_bracket: "Fill up bracket",
  } as Record<string, string>,
  transferMode: { one_time: "One-time", recurring: "Recurring", scheduled: "Scheduled" } as Record<string, string>,
  incomeType: {
    salary: "Salary", social_security: "Social Security", business: "Business",
    deferred: "Deferred comp", capital_gains: "Capital gains", trust: "Trust", other: "Other",
  } as Record<string, string>,
  expenseType: { living: "Living", other: "Other", insurance: "Insurance" } as Record<string, string>,
  accountCategory: {
    taxable: "Taxable", cash: "Cash", retirement: "Retirement", real_estate: "Real estate",
    business: "Business", life_insurance: "Life insurance", notes_receivable: "Notes receivable",
    education_savings: "529 / Education",
  } as Record<string, string>,
  bequestCondition: {
    if_spouse_survives: "if spouse survives", if_spouse_predeceased: "if spouse predeceased", always: "always",
  } as Record<string, string>,
  entityType: {
    trust: "Trust", llc: "LLC", s_corp: "S-corp", c_corp: "C-corp",
    partnership: "Partnership", foundation: "Foundation", other: "Entity",
  } as Record<string, string>,
  grantor: { client: "Client", spouse: "Spouse", joint: "Joint" } as Record<string, string>,
};

export const label = (group: keyof typeof ENUM_LABELS, key: unknown): string =>
  (typeof key === "string" && ENUM_LABELS[group][key]) || (key == null ? "—" : String(key));
