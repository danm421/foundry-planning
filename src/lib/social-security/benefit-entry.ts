// src/lib/social-security/benefit-entry.ts
//
// What the Social Security editors (the app dialog and the Solver's) share:
// the amount's display unit, the age a stated benefit is quoted at, the label
// a row shows as typed, and the live preview. Pure — no React, no IO.

import type { Income, ClientInfo } from "@/engine/types";
import { resolvePiaMonthly, statedAgeMonths } from "@/engine/socialSecurity/resolvePia";
import { resolveClaimAgeMonths, resolveEntitlementMonth } from "@/engine/socialSecurity/claimAge";
import { computeOwnMonthlyBenefit } from "@/engine/socialSecurity/ownRetirement";
import { resolveAnnualBenefit } from "@/engine/socialSecurity/orchestrator";
import { ssEntitlementMonth } from "@/engine/socialSecurity/entitlement";

export type SsAmountUnit = "monthly" | "annual";
export const SS_STATED_AGE_MIN = 62;
export const SS_STATED_AGE_MAX = 70;
export const SS_STATED_AGES: readonly number[] = Array.from(
  { length: SS_STATED_AGE_MAX - SS_STATED_AGE_MIN + 1 },
  (_, i) => SS_STATED_AGE_MIN + i,
);

/** A whole age the API accepts as a stated age (62-70). */
export function isStatedAge(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= SS_STATED_AGE_MIN && n <= SS_STATED_AGE_MAX;
}

/** The stated-age columns a writer stores beside a figure quoted at `age`. An
 *  age outside 62-70 (a misread one, an SSDI or 71+ claimant's current age) is
 *  not a stated age: it writes NULL, so the figure follows the claim age. */
export function statedAgeFields(age: number | null | undefined, unit: SsAmountUnit | null) {
  const ssStatedAge = isStatedAge(age) ? age : null;
  return { ssStatedAge, ssStatedAgeMonths: ssStatedAge != null ? 0 : null, ssAmountUnit: unit };
}

/** A stored unit, or null for anything else (NULL = the legacy default). */
export function asAmountUnit(v: unknown): SsAmountUnit | null {
  return v === "monthly" || v === "annual" ? v : null;
}

/** A Social Security row as any caller holds it: the engine `Income`, the
 *  scenario `IncomeView`, or a raw list-GET row — only the first has numbers. */
export interface SsRowLike {
  /** Optional: salary-shaped rows (`SalaryLike`) carry none. */
  id?: string;
  type: string;
  owner: string;
  name?: string;
  annualAmount: number | string | null;
  piaMonthly?: number | string | null;
  growthRate?: number | string | null;
  startYear?: number;
  endYear?: number | null;
  inflationStartYear?: number | null;
  ssBenefitMode?: string | null;
  claimingAge?: number | null;
  claimingAgeMonths?: number | null;
  claimingAgeMode?: string | null;
  ssStatedAge?: number | null;
  ssStatedAgeMonths?: number | null;
  ssAmountUnit?: string | null;
}

const num = (v: number | string | null | undefined): number | undefined =>
  v == null || v === "" ? undefined : Number(v);
export const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) =>
  `$${Math.round(n).toLocaleString("en-US")}`;

/** An annual figure from a MONTHLY one held to the cent. `pia_monthly` is
 *  stored at cents, so $54,001/yr saves as 4500.08/mo and × 12 reads
 *  54000.96. Within 6¢ of a dollar (the most cent-rounding a monthly figure
 *  can drift over 12 months) snaps to the dollar; otherwise keeps the cents.
 *  Integer cents so the 6¢ test never meets float noise. */
function annualFromMonthlyCents(monthly: number): number {
  const cents = Math.round(monthly * 1200);
  const dollars = Math.round(cents / 100);
  return Math.abs(cents - dollars * 100) <= 6 ? dollars : cents / 100;
}

export function asSsIncome(raw: SsRowLike): Income {
  return {
    id: raw.id ?? "other",
    type: "social_security",
    name: raw.name ?? "",
    annualAmount: num(raw.annualAmount) ?? 0,
    startYear: raw.startYear ?? 2000,
    endYear: raw.endYear ?? 2099,
    growthRate: num(raw.growthRate) ?? 0,
    inflationStartYear: raw.inflationStartYear ?? undefined,
    owner: raw.owner === "spouse" ? "spouse" : "client",
    claimingAge: raw.claimingAge ?? undefined,
    claimingAgeMonths: raw.claimingAgeMonths ?? 0,
    claimingAgeMode: (raw.claimingAgeMode as Income["claimingAgeMode"]) ?? undefined,
    ssBenefitMode: (raw.ssBenefitMode as Income["ssBenefitMode"]) ?? undefined,
    piaMonthly: num(raw.piaMonthly),
    ssStatedAge: raw.ssStatedAge ?? null,
    ssStatedAgeMonths: raw.ssStatedAgeMonths ?? null,
    ssAmountUnit: asAmountUnit(raw.ssAmountUnit),
  };
}

/** The OTHER spouse's row — first match, as `SocialSecurityCard.findRow` picks. */
export function otherSsRow(rows: readonly SsRowLike[], owner: "client" | "spouse"): Income | null {
  const other = owner === "client" ? "spouse" : "client";
  const hit = rows.find((r) => r.type === "social_security" && r.owner === other);
  return hit ? asSsIncome(hit) : null;
}

/** The unit an entry displays in: the one typed, else the legacy default —
 *  a PIA reads monthly (an SSA statement's unit), a stated benefit annually
 *  (what the old "Annual benefit amount" field held). */
export function entryUnit(
  row: { ssBenefitMode?: string | null; ssAmountUnit?: string | null } | null,
): SsAmountUnit {
  return asAmountUnit(row?.ssAmountUnit) ?? (row?.ssBenefitMode === "pia_at_fra" ? "monthly" : "annual");
}

export const toMonthly = (amount: number, unit: SsAmountUnit) => (unit === "monthly" ? amount : amount / 12);
export const toAnnual = (amount: number, unit: SsAmountUnit) => (unit === "annual" ? amount : amount * 12);

/** The amount box's text, re-expressed when the advisor flips /mo ↔ /yr. */
export function convertAmountText(text: string, from: SsAmountUnit, to: SsAmountUnit): string {
  const n = parseFloat(text);
  if (from === to || text.trim() === "" || isNaN(n)) return text;
  return String(to === "monthly" ? round2(n / 12) : annualFromMonthlyCents(n));
}

/** The figure an existing row opens on, in its display unit. Rounded to cents
 *  so $68,478/yr opened monthly reads 5706.5, not 5706.499999. */
export function initialEntryAmount(row: Income | null): string {
  if (!row) return "";
  const unit = entryUnit(row);
  if (row.ssBenefitMode === "pia_at_fra") {
    const pia = num(row.piaMonthly);
    if (pia == null) return "";
    return String(unit === "monthly" ? round2(pia) : annualFromMonthlyCents(pia));
  }
  const annual = num(row.annualAmount);
  if (annual == null || !(annual > 0)) return "";
  return String(round2(unit === "annual" ? annual : annual / 12));
}

/** The amount box and unit an editor opens on, from ONE reading of the row so
 *  the text always matches its label: the PIA when the row opens on one, else
 *  the stated figure. A row opening on the salary estimate seeds the advisor's
 *  own stated figure when it holds one, so switching to "Benefit at a specific
 *  age" shows it; its unit is the PIA's (the estimate is monthly-native). */
export function initialEntry(
  row: Income | null,
  openingMode: NonNullable<Income["ssBenefitMode"]> | "estimate_from_salary",
): { amount: string; unit: SsAmountUnit } {
  const estimate = openingMode === "estimate_from_salary";
  const holdsStated = estimate && Number(row?.annualAmount ?? 0) > 0;
  const seedMode = openingMode === "pia_at_fra" || (estimate && !holdsStated) ? "pia_at_fra" : "manual_amount";
  const unit = entryUnit({ ssBenefitMode: estimate ? "pia_at_fra" : openingMode, ssAmountUnit: row?.ssAmountUnit });
  return { unit, amount: initialEntryAmount(row && { ...row, ssBenefitMode: seedMode, ssAmountUnit: unit }) };
}

/** The age a stated benefit is quoted at, as the engine reads it
 *  (`statedAgeMonths`): the stored one, else the row's resolved claim age
 *  (legacy meaning). Years outside the 62-70 selects snap to that boundary
 *  with 0 months; within them the months are kept, clamped to 0-11. Save sends
 *  this back, and the API rejects any age outside 62-70. */
export function initialStatedAge(row: Income | null, client: ClientInfo): { years: number; months: number } {
  const m = row ? statedAgeMonths(row, client) : null;
  if (m == null) return { years: 67, months: 0 };
  const years = Math.floor(m / 12);
  if (years < SS_STATED_AGE_MIN) return { years: SS_STATED_AGE_MIN, months: 0 };
  if (years > SS_STATED_AGE_MAX) return { years: SS_STATED_AGE_MAX, months: 0 };
  return { years, months: Math.min(Math.max(Math.trunc(m - years * 12), 0), 11) };
}

/** The calendar year a benefit claimed at this age starts, for the "· 2028" hint. */
export function statedAgeYear(dob: string | undefined, years: number, months: number): number | null {
  if (!dob) return null;
  return ssEntitlementMonth(dob, years * 12 + months)?.year ?? null;
}

export const ageLabel = (years: number, months: number) => (months > 0 ? `${years}y ${months}mo` : `${years}`);

/** "$5,707/mo at 70", "$68,478/yr at 70y 6mo", "$4,505/mo PIA" — the entry as
 *  typed. Null for No benefit or nothing entered. */
export function ssEntryLabel(row: Income, client: ClientInfo): string | null {
  const mode = row.ssBenefitMode ?? "manual_amount";
  if (mode === "no_benefit") return null;
  const unit = entryUnit(row);
  const suffix = unit === "monthly" ? "/mo" : "/yr";
  if (mode === "pia_at_fra") {
    const pia = num(row.piaMonthly);
    // $0 is a real PIA (no work record) — only an unset one is "nothing entered".
    if (pia == null) return null;
    return `${money(unit === "monthly" ? pia : pia * 12)}${suffix} PIA`;
  }
  const annual = num(row.annualAmount) ?? 0;
  if (!(annual > 0)) return null;
  const at = initialStatedAge(row, client);
  return `${money(unit === "annual" ? annual : annual / 12)}${suffix} at ${ageLabel(at.years, at.months)}`;
}

export interface SsEntryPreview {
  /** The PIA every adjustment runs off, monthly, today's dollars. */
  piaMonthly: number;
  /** The other person's PIA, resolved the same way; null = no other row or
   *  not priced off a PIA. */
  otherPiaMonthly: number | null;
  /** The claim age, in total months; null = unresolvable. */
  claimAgeMonths: number | null;
  /** Own benefit at the claim age, annual, today's dollars. */
  ownAnnual: number | null;
  /** Monthly spousal top-up each person draws off the other's record once both
   *  are paid all year; 0 = none. Null = no other row / cannot tell. */
  topUps: { client: number | null; spouse: number | null };
}

/** The editor's live preview, priced by the engine's own functions so it can
 *  never disagree with the projection. COLA is zeroed: today's dollars. Null
 *  while a stated benefit's box is blank or $0 — that is no answer yet, where
 *  a $0 PIA is a real one (no work record). */
export function ssEntryPreview(draft: Income, other: Income | null, client: ClientInfo): SsEntryPreview | null {
  if ((draft.ssBenefitMode ?? "manual_amount") === "manual_amount" && !(draft.annualAmount > 0)) return null;
  const pia = resolvePiaMonthly(draft, client);
  if (pia == null) return null;
  const dob = draft.owner === "spouse" ? client.spouseDob : client.dateOfBirth;
  const claim = resolveClaimAgeMonths(draft, client);
  const ownAnnual =
    dob && claim != null ? computeOwnMonthlyBenefit({ piaMonthly: pia, claimAgeMonths: claim, dob }) * 12 : null;

  const topUps: SsEntryPreview["topUps"] = { client: null, spouse: null };
  if (other && other.ssBenefitMode !== "no_benefit") {
    const a = resolveEntitlementMonth(draft, client);
    const b = resolveEntitlementMonth(other, client);
    if (a && b) {
      // The first year both are paid all twelve months — a steady-state figure.
      const year = Math.max(a.year, b.year) + 1;
      const flat = (r: Income): Income => ({ ...r, growthRate: 0 });
      const mine = resolveAnnualBenefit({ row: flat(draft), spouseRow: flat(other), client, year });
      const theirs = resolveAnnualBenefit({ row: flat(other), spouseRow: flat(draft), client, year });
      const me = draft.owner === "spouse" ? "spouse" : "client";
      const them = me === "client" ? "spouse" : "client";
      topUps[me] = mine.spousal / 12;
      topUps[them] = theirs.spousal / 12;
    }
  }
  return {
    piaMonthly: pia,
    otherPiaMonthly: other ? resolvePiaMonthly(other, client) : null,
    claimAgeMonths: claim,
    ownAnnual,
    topUps,
  };
}

/** The engine row an editor previews: the typed amount read in its unit and
 *  stored canonically (a stated benefit annual, a PIA monthly). The stated age
 *  is set only for a stated benefit; null = the row's own claim age. */
export function ssDraftRow(p: {
  amount: string;
  unit: SsAmountUnit;
  mode: NonNullable<Income["ssBenefitMode"]>;
  statedAge: { years: number; months: number };
  claimingAge: number;
  claimingAgeMonths: number;
  claimingAgeMode: NonNullable<Income["claimingAgeMode"]>;
  owner: "client" | "spouse";
  id: string;
  year: number;
}): Income {
  const typed = parseFloat(p.amount);
  const isStated = p.mode === "manual_amount";
  return {
    id: p.id, type: "social_security", name: "",
    annualAmount: isStated && !isNaN(typed) ? toAnnual(typed, p.unit) : 0,
    startYear: p.year, endYear: 2099, growthRate: 0, owner: p.owner,
    claimingAge: p.claimingAge, claimingAgeMonths: p.claimingAgeMonths, claimingAgeMode: p.claimingAgeMode,
    ssBenefitMode: p.mode,
    piaMonthly: !isStated && !isNaN(typed) ? toMonthly(typed, p.unit) : undefined,
    ssStatedAge: isStated ? p.statedAge.years : null,
    ssStatedAgeMonths: isStated ? p.statedAge.months : null,
  };
}

/** True while the claim age is a specific age equal to the stated age — the
 *  claim age then follows the stated age as the advisor changes it. */
export function claimTracksStatedAge(
  claim: { claimingAgeMode: string; claimingAge: number; claimingAgeMonths: number },
  stated: { years: number; months: number },
): boolean {
  return claim.claimingAgeMode === "years" && claim.claimingAge === stated.years && claim.claimingAgeMonths === stated.months;
}

/** The claim age after the stated age moves from `prev` to `next`: carried
 *  along while it tracks `prev`, else null (leave it alone). */
export function claimAfterStatedAgeChange(
  claim: { claimingAgeMode: string; claimingAge: number; claimingAgeMonths: number },
  prev: { years: number; months: number },
  next: { years: number; months: number },
): { claimingAge: number; claimingAgeMonths: number } | null {
  return claimTracksStatedAge(claim, prev) ? { claimingAge: next.years, claimingAgeMonths: next.months } : null;
}

/** Choosing "Benefit at a specific age" claims at the stated age to start. */
export function claimOnSelectStated(stated: { years: number; months: number }) {
  return { claimingAgeMode: "years" as const, claimingAge: stated.years, claimingAgeMonths: stated.months };
}
