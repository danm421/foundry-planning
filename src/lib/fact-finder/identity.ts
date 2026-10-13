// src/lib/fact-finder/identity.ts
import { custodianMatches, normalizeCustodian } from "@/lib/imports/normalize-custodian";
import { matchOption } from "./normalize";
import { GRANT_TYPE } from "./schema";
import type { FFCellValue } from "./types";

type Values = Record<string, FFCellValue>;

/** Lower-case words: "Joint  Brokerage!" → "joint brokerage". */
export function normText(v: FFCellValue | undefined): string {
  if (v === null || v === undefined) return "";
  return String(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** The last four digits of anything printed ("xxxx-2201" → "2201"); "" when there aren't four. */
export function last4Of(v: FFCellValue | undefined): string {
  const digits = String(v ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : "";
}

/** Both present and equal. */
const eq = (a: FFCellValue | undefined, b: FFCellValue | undefined) => {
  const x = normText(a);
  return x !== "" && x === normText(b);
};
/** Equal, or missing on either side (no contradiction). */
const agrees = (a: FFCellValue | undefined, b: FFCellValue | undefined) => {
  const x = normText(a);
  const y = normText(b);
  return x === "" || y === "" || x === y;
};

/**
 * Same custodian, allowing for how differently one firm gets printed:
 * "Fidelity" / "Fidelity Investments" (prefix) and "Schwab" / "Charles Schwab"
 * (a shared word of 4+ letters). Missing on either side is no contradiction.
 */
function custodiansAgree(a: FFCellValue | undefined, b: FFCellValue | undefined): boolean {
  const ca = normalizeCustodian(a === null || a === undefined ? null : String(a));
  const cb = normalizeCustodian(b === null || b === undefined ? null : String(b));
  if (!ca || !cb) return true;
  if (custodianMatches(ca, cb)) return true;
  const words = new Set(ca.split(" ").filter((w) => w.length >= 4));
  return cb.split(" ").some((w) => words.has(w));
}

function sameAccount(a: Values, b: Values, nameColumn: string, custodianColumn: string): boolean {
  const custodians = custodiansAgree(a[custodianColumn], b[custodianColumn]);
  const la = last4Of(a.last4);
  const lb = last4Of(b.last4);
  if (la && lb) return la === lb && custodians;
  // By name alone, owners must not contradict either: a Client "Roth IRA" and a
  // Co-client "Roth IRA" are two accounts, and so are a Chase "Checking" and a Wells Fargo one.
  return eq(a[nameColumn], b[nameColumn]) && agrees(a.owner, b.owner) && custodians;
}

const grantTypeOf = (v: FFCellValue | undefined) => (typeof v === "string" ? matchOption(v, GRANT_TYPE) : null);

/**
 * Grant types contradict only when both sides are one of the options (an app
 * record's "rsu" counts): a type no option covers ("Performance shares")
 * can't keep a row apart or block a link.
 */
export function grantTypesAgree(a: FFCellValue | undefined, b: FFCellValue | undefined): boolean {
  const x = grantTypeOf(a);
  const y = grantTypeOf(b);
  return x === null || y === null || x === y;
}

function samePolicyNumber(a: FFCellValue | undefined, b: FFCellValue | undefined): boolean | null {
  const x = normText(a).replace(/ /g, "");
  const y = normText(b).replace(/ /g, "");
  if (!x || !y) return null;
  if (x === y) return true;
  const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
  return shorter.length >= 4 && longer.endsWith(shorter);
}

const account = (name: string, custodian = "custodian") => (a: Values, b: Values) => sameAccount(a, b, name, custodian);
const insurer = (a: Values, b: Values) =>
  eq(a.carrier, b.carrier) && eq(a.whoIsCovered, b.whoIsCovered) && agrees(a.policyName, b.policyName);

/** "Same row?" per section (spec § 2). Fixed-row sections merge by their fixed label instead. */
const RULES: Record<string, (a: Values, b: Values) => boolean> = {
  family: (a, b) =>
    eq(a.firstName, b.firstName) &&
    (a.dateOfBirth && b.dateOfBirth ? a.dateOfBirth === b.dateOfBirth : agrees(a.lastName, b.lastName)),
  external: (a, b) => eq(a.name, b.name),
  cash: account("accountName"),
  taxable: account("accountName"),
  retirement: account("accountName"),
  edu: account("accountName"),
  annuity: account("contractName", "carrier"),
  equity: (a, b) =>
    normText(a.grantNumber) && normText(b.grantNumber)
      ? eq(a.grantNumber, b.grantNumber)
      : eq(a.company, b.company) && agrees(a.grantDate, b.grantDate) && grantTypesAgree(a.grantType, b.grantType),
  notes_rec: (a, b) => eq(a.borrower, b.borrower),
  realestate: (a, b) => eq(a.propertyName, b.propertyName) || eq(a.address, b.address),
  business: (a, b) => eq(a.businessName, b.businessName),
  liab: (a, b) => eq(a.loanName, b.loanName) && agrees(a.propertyName, b.propertyName),
  income: (a, b) => eq(a.incomeName, b.incomeName) && agrees(a.owner, b.owner) && agrees(a.type, b.type),
  living_items: (a, b) => eq(a.item, b.item),
  expenses: (a, b) => eq(a.expenseName, b.expenseName) && agrees(a.type, b.type),
  savings: (a, b) => eq(a.account, b.account) && agrees(a.contribution, b.contribution),
  life: (a, b) => {
    const byNumber = samePolicyNumber(a.policyNumber, b.policyNumber);
    if (byNumber !== null) return byNumber;
    // Or, like accounts, the same name with nothing contradicting it: a statement can
    // print neither number nor carrier, and every read re-merges earlier statements.
    return (
      (eq(a.carrier, b.carrier) && eq(a.insured, b.insured) && agrees(a.policyName, b.policyName)) ||
      (eq(a.policyName, b.policyName) && agrees(a.carrier, b.carrier) && agrees(a.insured, b.insured))
    );
  },
  disability: insurer,
  ltc: insurer,
  trusts: (a, b) => eq(a.trustName, b.trustName),
  bequests: (a, b) =>
    eq(a.willOf, b.willOf) && eq(a.gift, b.gift) && agrees(a.asset, b.asset) && agrees(a.condition, b.condition),
  gifts: (a, b) => a.year != null && a.year === b.year && eq(a.from, b.from) && eq(a.recipient, b.recipient),
};

export function hasIdentityRule(sectionId: string): boolean {
  return sectionId in RULES;
}

export function sameIdentity(sectionId: string, a: Values, b: Values): boolean {
  const rule = RULES[sectionId];
  return rule ? rule(a, b) : false;
}
