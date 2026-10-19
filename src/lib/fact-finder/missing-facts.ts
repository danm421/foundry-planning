// src/lib/fact-finder/missing-facts.ts
/**
 * What a household's plan still lacks, read off the record book: the facts the
 * projection needs that no record holds yet, each under the onboarding step
 * that collects it. Pure — no IO. Labels name the person from the book's
 * first names, or use the record's own label.
 */
import type { FactFinderStepId } from "@/domain/mcp/fact-finder-steps";
import { FACT_FINDER_STEP_IDS } from "@/domain/mcp/fact-finder-steps";
import type { PlacedValue, TargetKind } from "./change-set";
import type { BookRecord, RecordBook } from "./placement/types";

export interface MissingFact {
  step: FactFinderStepId;
  target: TargetKind;
  /** The record that lacks it; null when no record exists to hold it. */
  recordId: string | null;
  label: string;
  missing: string;
}

type Role = "client" | "spouse";

/** A plain number in a book value; null for anything else. */
const numberOf = (value: PlacedValue | undefined): number | null => (typeof value === "number" ? value : null);
const blank = (value: PlacedValue | undefined) => value === null || value === undefined || value === "";
/** Blank or $0: nothing entered. */
const unset = (value: PlacedValue | undefined) => blank(value) || value === 0;

/** The person roles an owners list or an owner ref names. */
function ownerRoles(owners: PlacedValue | undefined): Role[] {
  if (!Array.isArray(owners)) return [];
  return owners.flatMap((o) => {
    const who = typeof o === "object" && o !== null && !Array.isArray(o) ? (o as { who?: PlacedValue }).who : null;
    return typeof who === "object" && who !== null && !Array.isArray(who) && who.ref === "person" ? [who.role as Role] : [];
  });
}

export function missingFacts(book: RecordBook, opts: { currentYear: number }): MissingFact[] {
  const found: MissingFact[] = [];
  const add = (step: FactFinderStepId, target: TargetKind, r: BookRecord | null, label: string, missing: string) =>
    found.push({ step, target, recordId: r?.id ?? null, label, missing });
  const rec = (target: TargetKind) => book.records[target];

  // The two people, as the household record gives them.
  const home = rec("client_household")[0];
  const person = (role: Role) => {
    const v = home?.values ?? {};
    const hasSecond = role === "client" || !blank(v.spouseName) || book.people.spouse !== null;
    const dob = role === "client" ? v.dateOfBirth : v.spouseDob;
    const retireAge = numberOf(role === "client" ? v.retirementAge : v.spouseRetirementAge);
    const born = typeof dob === "string" && dob.length >= 4 ? Number(dob.slice(0, 4)) : null;
    return {
      role,
      exists: !!home && hasSecond,
      dob,
      name: book.names[role] ?? (role === "client" ? "The client" : "The second person"),
      // Still working: under retirement age this year. Unknown without both.
      working: born !== null && retireAge !== null && opts.currentYear - born < retireAge,
    };
  };
  const people = [person("client"), person("spouse")].filter((p) => p.exists);
  const working = (role: Role) => people.find((p) => p.role === role)?.working === true;

  // household
  for (const p of people) if (blank(p.dob)) add("household", "client_household", home, p.name, "date of birth");
  for (const r of rec("family_member")) if (blank(r.values.dateOfBirth)) add("household", "family_member", r, r.label, "date of birth");

  // real_estate
  for (const r of rec("account")) {
    if (r.facts?.category === "real_estate" && unset(r.values.annualPropertyTax)) add("real_estate", "account", r, r.label, "annual property tax");
  }

  // balance_sheet
  for (const r of rec("liability")) {
    const type = r.values.liabilityType;
    if ((type === "mortgage" || type === "heloc") && blank(r.values.linkedPropertyId)) add("balance_sheet", "liability", r, r.label, "the property it's on");
  }

  // income
  const incomes = rec("income");
  for (const p of people) {
    if (!p.working) continue;
    const hasSalary = incomes.some((r) => r.facts?.type === "salary" && (r.facts.owner === p.role || r.facts.owner === "joint"));
    if (!hasSalary) add("income", "client_household", home, p.name, "a salary, or confirmation there is none");
  }
  for (const r of incomes) {
    if (r.facts?.type === "social_security" && unset(r.values.piaMonthly)) add("income", "income", r, r.label, "a benefit estimate");
  }

  // savings
  const savedInto = new Set(rec("savings_rule").map((r) => r.facts?.accountId));
  for (const r of rec("account")) {
    if (r.facts?.category !== "retirement" || savedInto.has(r.id)) continue;
    if (ownerRoles(r.values.owners).some(working)) add("savings", "account", r, r.label, "contributions, or confirmation there are none");
  }

  // goals
  for (const r of rec("expense")) {
    if (r.values.isGoal === true && (unset(r.values.annualAmount) || blank(r.values.start))) add("goals", "expense", r, r.label, "amount and timing");
  }

  // living_expenses
  const livingCosts = rec("expense").filter((r) => r.facts?.type === "living");
  if (livingCosts.every((r) => unset(r.values.annualAmount))) {
    add("living_expenses", "expense", null, "Living expenses", "current living expenses");
  }

  // insurance
  for (const r of rec("life_insurance_policy")) {
    if (unset(r.values.faceValue)) add("insurance", "life_insurance_policy", r, r.label, "death benefit");
    if (blank(r.values.ownerRef)) add("insurance", "life_insurance_policy", r, r.label, "owner");
  }

  // estate: a will names who inherits through a bequest or its remaining-estate recipients.
  for (const w of rec("will")) {
    const hasBequest = rec("will_bequest").some((b) => b.facts?.willId === w.id);
    const residuary = rec("will_residuary_recipient").find((r) => r.id === w.id)?.values.recipients;
    if (!hasBequest && !(Array.isArray(residuary) && residuary.length > 0)) add("estate", "will", w, w.label, "who inherits");
  }

  return found;
}

/** How many gaps each step has — every step present, 0 included. */
export function missingFactsByStep(missing: MissingFact[]): Record<FactFinderStepId, number> {
  const counts = Object.fromEntries(FACT_FINDER_STEP_IDS.map((s) => [s, 0])) as Record<FactFinderStepId, number>;
  for (const m of missing) counts[m.step] += 1;
  return counts;
}
