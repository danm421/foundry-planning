// src/domain/forge/row-lines.ts
//
// Human-readable detail lines for the approval card. Pure — no IO.
//
// The card used to dump every column of the would-be row as raw
// `camelCase: value` — `titlingType: jtwros`, `propertyTaxGrowthSource: custom`,
// fourteen lines for one brokerage account. An advisor approving "add these
// three accounts" needs the handful of facts that matter — what it is, what
// it's worth, who owns it — in plain words with real money formatting. So each
// entity kind has a short ORDERED whitelist of fields, defaults that carry no
// information are dropped, and every value goes through one formatter keyed by
// field name (money, rate, year, enum) so add and edit previews read the same.

import {
  formatAccountCategory,
  formatAccountSubType,
} from "@/lib/accounts/category-labels";

export type RowKind = "account" | "expense" | "income" | "liability";

type Row = Record<string, unknown>;

const LABELS: Record<string, string> = {
  name: "Name",
  type: "Type",
  category: "Category",
  subType: "Account type",
  value: "Balance",
  basis: "Cost basis",
  rothValue: "Roth portion",
  priorYearEndValue: "Prior year-end value",
  growthRate: "Growth rate",
  growthSource: "Growth",
  custodian: "Custodian",
  accountNumberLast4: "Account ending",
  annualAmount: "Annual amount",
  startYear: "Starts",
  endYear: "Ends",
  owner: "Owner",
  balance: "Balance",
  interestRate: "Interest rate",
  monthlyPayment: "Monthly payment",
  termMonths: "Term",
  startMonth: "Start month",
  claimingAge: "Claiming age",
  claimingAgeMonths: "Claiming age (extra months)",
  piaMonthly: "PIA (monthly)",
  taxType: "Tax treatment",
  deductionType: "Deduction",
  paymentMonth: "Payment month",
  isInterestDeductible: "Interest deductible",
  isGoal: "Tracked as a goal",
  rmdEnabled: "RMDs",
  countsTowardAum: "Counts toward AUM",
  annualPropertyTax: "Property tax",
  propertyTaxGrowthRate: "Property tax growth",
  titlingType: "Titling",
  businessType: "Business type",
  activationYear: "Activates",
  hsaCoverage: "HSA coverage",
  forgiveAtTermEnd: "Forgiven at term end",
  modelPortfolioId: "Model portfolio",
  tickerPortfolioId: "Ticker portfolio",
  parentAccountId: "Parent business",
  linkedPropertyId: "Secured by",
  cashAccountId: "Cash account",
  ownerEntityId: "Owning entity",
  ownerAccountId: "Owning business",
};

const MONEY = new Set([
  "value",
  "basis",
  "rothValue",
  "priorYearEndValue",
  "annualAmount",
  "balance",
  "monthlyPayment",
  "piaMonthly",
  "annualPropertyTax",
]);

/** Fractions (0.03 = 3%) — the tool descriptions document these as "e.g. 0.03". */
const RATE = new Set(["growthRate", "interestRate", "propertyTaxGrowthRate"]);

const ENUM_LABELS: Record<string, string> = {
  jtwros: "Joint (JTWROS)",
  tic: "Tenants in common",
  s_corp: "S corp",
  c_corp: "C corp",
  llc: "LLC",
  sole_prop: "Sole proprietorship",
  hsa: "HSA",
};

/** "annualPropertyTax" → "Annual property tax"; "modelPortfolioId" → "Model portfolio". */
function humanizeField(field: string): string {
  const words = field
    .replace(/Id$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "taxable_brokerage" → "Taxable brokerage"; known tokens get their curated label. */
function humanizeEnum(v: string): string {
  const known = ENUM_LABELS[v];
  if (known) return known;
  const words = v.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function fieldLabel(field: string): string {
  return LABELS[field] ?? humanizeField(field);
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function formatMoney(v: unknown): string {
  const n = toNumber(v);
  if (n == null) return String(v);
  const abs = Math.abs(n);
  const hasCents = Math.round(abs * 100) % 100 !== 0;
  const body = abs.toLocaleString("en-US", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  });
  return `${n < 0 ? "-" : ""}$${body}`;
}

/** 0.03 → "3%", 0.0625 → "6.3%" (at most one decimal, per the grounding rules). */
export function formatRate(v: unknown): string {
  const n = toNumber(v);
  if (n == null) return String(v);
  return `${(n * 100).toFixed(1).replace(/\.0$/, "")}%`;
}

function formatTerm(v: unknown): string {
  const n = toNumber(v);
  if (n == null) return String(v);
  const years = n >= 12 && n % 12 === 0 ? ` (${n / 12} yrs)` : "";
  return `${n} months${years}`;
}

/** One formatter for every field, so add and edit previews read the same. */
export function formatFieldValue(field: string, v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (MONEY.has(field)) return formatMoney(v);
  if (RATE.has(field)) return formatRate(v);
  if (field === "termMonths") return formatTerm(v);
  if (field === "category" && typeof v === "string") return formatAccountCategory(v);
  if (field === "subType" && typeof v === "string") return formatAccountSubType(v);
  if (field === "accountNumberLast4") return `…${String(v)}`;
  // A raw id on the card tells the advisor nothing; the label alone says what changed.
  if (field.endsWith("Id") && typeof v === "string") return "(changed)";
  if (typeof v === "string" && /^[a-z0-9]+(_[a-z0-9]+)*$/.test(v)) return humanizeEnum(v);
  return String(v);
}

function line(field: string, v: unknown): string {
  return `${fieldLabel(field)}: ${formatFieldValue(field, v)}`;
}

function isBlank(v: unknown): boolean {
  return v == null || v === "" || v === false;
}

function isZero(v: unknown): boolean {
  return toNumber(v) === 0;
}

/** "Years: 2026–2040", "Year: 2026", or "Starts: 2026" — whatever the row has. */
function yearsLine(row: Row): string | null {
  const start = toNumber(row.startYear);
  const end = toNumber(row.endYear);
  if (start != null && end != null) return start === end ? `Year: ${start}` : `Years: ${start}–${end}`;
  if (start != null) return `Starts: ${start}`;
  if (end != null) return `Ends: ${end}`;
  return null;
}

/** Growth reads as one fact: tracks inflation, or grows at a stated rate. */
function growthLine(row: Row): string | null {
  if (row.growthSource === "inflation") return "Growth: Tracks inflation";
  if (row.growthSource === "default") return null;
  if (isBlank(row.growthRate)) return null;
  return `Growth rate: ${formatRate(row.growthRate)}`;
}

function accountLines(row: Row): string[] {
  const out: string[] = [];
  const category = typeof row.category === "string" ? formatAccountCategory(row.category) : null;
  const subType =
    typeof row.subType === "string" && row.subType !== "other"
      ? formatAccountSubType(row.subType)
      : null;
  if (category) out.push(`Type: ${subType ? `${category} · ${subType}` : category}`);
  if (row.businessType != null) out.push(line("businessType", row.businessType));
  // The balance is the headline even at $0 — a zero here is a fact worth seeing.
  out.push(line("value", row.value ?? 0));
  for (const f of ["basis", "rothValue", "annualPropertyTax"]) {
    if (!isBlank(row[f]) && !isZero(row[f])) out.push(line(f, row[f]));
  }
  if (!isBlank(row.custodian)) out.push(line("custodian", row.custodian));
  if (!isBlank(row.accountNumberLast4)) out.push(line("accountNumberLast4", row.accountNumberLast4));
  const growth = growthLine(row);
  if (growth) out.push(growth);
  if (row.rmdEnabled === true) out.push("RMDs: Yes");
  return out;
}

function flowLines(row: Row, kind: "expense" | "income"): string[] {
  const out: string[] = [];
  if (!isBlank(row.type)) out.push(line("type", row.type));
  if (kind === "income" && !isBlank(row.owner)) out.push(line("owner", row.owner));
  out.push(line("annualAmount", row.annualAmount ?? 0));
  const years = yearsLine(row);
  if (years) out.push(years);
  const growth = growthLine(row);
  if (growth) out.push(growth);
  if (kind === "income") {
    if (!isBlank(row.claimingAge)) out.push(line("claimingAge", row.claimingAge));
    if (!isBlank(row.piaMonthly) && !isZero(row.piaMonthly)) out.push(line("piaMonthly", row.piaMonthly));
    if (!isBlank(row.taxType)) out.push(line("taxType", row.taxType));
  } else {
    if (!isBlank(row.deductionType)) out.push(line("deductionType", row.deductionType));
    if (row.isGoal === true) out.push("Tracked as a goal: Yes");
  }
  if (!isBlank(row.paymentMonth)) out.push(line("paymentMonth", row.paymentMonth));
  return out;
}

/** Balance, rate, payment, and term define a loan — all four show even at zero,
 *  because a 0% rate or a $0 payment is exactly the kind of gap the advisor
 *  should catch before approving. */
function liabilityLines(row: Row): string[] {
  const out: string[] = [
    line("balance", row.balance ?? 0),
    line("interestRate", row.interestRate ?? 0),
    line("monthlyPayment", row.monthlyPayment ?? 0),
  ];
  if (!isBlank(row.termMonths)) out.push(line("termMonths", row.termMonths));
  if (!isBlank(row.startYear)) out.push(`Starts: ${row.startYear}`);
  if (row.isInterestDeductible === true) out.push("Interest deductible: Yes");
  if (row.forgiveAtTermEnd === true) out.push("Forgiven at term end: Yes");
  return out;
}

/** The high-level facts of a would-be new row, in plain words. */
export function newRowLines(kind: RowKind, row: Row): string[] {
  switch (kind) {
    case "account":
      return accountLines(row);
    case "expense":
      return flowLines(row, "expense");
    case "income":
      return flowLines(row, "income");
    case "liability":
      return liabilityLines(row);
  }
}

/** Bookkeeping columns a row diff can carry that mean nothing to the advisor. */
const HIDDEN_EDIT_FIELDS = new Set([
  "id",
  "clientId",
  "scenarioId",
  "firmId",
  "createdAt",
  "updatedAt",
  "owners",
]);

/** `Label: before → after` for each changed field. */
export function editLines(
  fields: ReadonlyArray<{ field: string; from: unknown; to: unknown }>,
): string[] {
  return fields
    .filter((f) => !HIDDEN_EDIT_FIELDS.has(f.field))
    .map((f) => `${fieldLabel(f.field)}: ${formatFieldValue(f.field, f.from)} → ${formatFieldValue(f.field, f.to)}`);
}

export type ProposedOwner = {
  kind?: string;
  familyMemberId?: string;
  entityId?: string;
  percent?: number;
};

/**
 * Ownership as a person would say it. `resolveName` maps an owner to a display
 * name (the enrichment looks it up in the plan tree); an owner it can't name
 * falls back to "a family member" / "an entity". A single 100% owner with no
 * resolvable name is dropped — "Owner: a family member" tells the advisor
 * nothing, and the raw id it replaced told them even less.
 */
export function ownershipLines(
  parentAccountId: string | null | undefined,
  owners: ProposedOwner[] | undefined,
  resolveName: (o: ProposedOwner) => string | undefined = () => undefined,
): string[] {
  if (parentAccountId != null) return ["Owned through the parent business account."];
  if (!owners || owners.length === 0) return [];
  const named = owners.map((o) => ({
    name: resolveName(o),
    pct: Math.round((o.percent ?? 0) * 100),
    fallback: o.kind === "entity" ? "an entity" : "a family member",
  }));
  if (named.length === 1) {
    const [only] = named;
    if (!only.name) return [];
    return [only.pct === 100 ? `Owner: ${only.name}` : `Owner: ${only.name} (${only.pct}%)`];
  }
  return [`Ownership: ${named.map((o) => `${o.name ?? o.fallback} ${o.pct}%`).join(" · ")}`];
}
