// src/lib/fact-finder/readers/statement-adapter.ts
import type { ExtractedAccount, ExtractedHolding, ExtractedLiability } from "@/lib/extraction/types";
import { resolveAccountCategory } from "@/lib/imports/commit/account-category";
import { livingHoldings } from "@/lib/imports/living-rows";
import { resolveOwnersFromHint, type OwnerMatchFamilyMember } from "@/lib/imports/owner-match";
import type { Annotated } from "@/lib/imports/types";
import {
  ANNUITY_TAX_MAP,
  BUSINESS_SUBTYPE_MAP,
  CASH_TYPE_MAP,
  LIFE_SUBTYPE_MAP,
  PROPERTY_TYPE_MAP,
  RETIRE_TYPE_MAP,
  TAXABLE_TYPE_MAP,
  labelFor,
} from "../enums";
import type { FFCellValue, FFReadCell, FFReadHolding, FFReading, FFSource } from "../types";

/** Statement values are read by today's tuned statement reader. */
export const STATEMENT_CONFIDENCE = 0.9;
/** A guess (the extractor's client/spouse/joint, a loan type from its name) — shows "check this". */
export const GUESSED_CONFIDENCE = 0.6;

type Cells = Record<string, FFReadCell | undefined>;

function compact(cells: Cells): Record<string, FFReadCell> {
  const out: Record<string, FFReadCell> = {};
  for (const [k, v] of Object.entries(cells)) if (v) out[k] = v;
  return out;
}

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

function cellMaker(source: FFSource) {
  return (value: FFCellValue | undefined, confidence = STATEMENT_CONFIDENCE): FFReadCell | undefined =>
    value === null || value === undefined || value === "" ? undefined : { value, confidence, source };
}

function sourceOf(row: { __provenance?: { sourceFileId: string; pageRange?: [number, number] } }): FFSource {
  const page = row.__provenance?.pageRange?.[0];
  return { fileId: row.__provenance?.sourceFileId ?? "", ...(page ? { page } : {}) };
}

function readHoldings(row: { holdings?: ExtractedHolding[] }): FFReadHolding[] | undefined {
  const living = livingHoldings(row);
  if (living.length === 0) return undefined;
  return living.map((h) => {
    const out: FFReadHolding = {};
    if (h.ticker) out.ticker = h.ticker;
    if (h.name) out.name = h.name;
    if (typeof h.shares === "number") out.shares = h.shares;
    if (typeof h.price === "number") out.price = h.price;
    if (typeof h.marketValue === "number") out.marketValue = h.marketValue;
    if (typeof h.costBasis === "number") out.costBasis = h.costBasis;
    return out;
  });
}

const COARSE_LABEL = { client: "Client", spouse: "Co-client", joint: "Joint" } as const;

/**
 * Owner label from the printed registration ("MARK & LAURA HENDRICKS JTWROS").
 * The extractor's coarse client/spouse/joint field is a model guess on every
 * row, so it is used only when there's no household roster to check against.
 */
function ownerCell(
  row: ExtractedAccount,
  family: OwnerMatchFamilyMember[],
  source: FFSource,
  allowJoint: boolean,
): FFReadCell | undefined {
  let label: string | null = null;
  let confidence = STATEMENT_CONFIDENCE;
  if (family.some((f) => f.role === "client")) {
    const resolution = resolveOwnersFromHint(row.ownerNameHint, row.owner, family);
    if (resolution.source !== "hint") return undefined;
    const roles = new Set(
      resolution.owners.flatMap((o) =>
        o.kind === "family_member" ? [family.find((f) => f.id === o.familyMemberId)?.role] : [],
      ),
    );
    if (roles.has("client") && roles.has("spouse")) label = "Joint";
    else if (roles.size === 1 && roles.has("client")) label = "Client";
    else if (roles.size === 1 && roles.has("spouse")) label = "Co-client";
  } else if (row.owner) {
    label = COARSE_LABEL[row.owner];
    confidence = GUESSED_CONFIDENCE;
  }
  if (!label || (label === "Joint" && !allowJoint)) return undefined;
  return { value: label, confidence, source };
}

export function readingFromAccount(
  row: Annotated<ExtractedAccount>,
  family: OwnerMatchFamilyMember[],
): FFReading | null {
  const source = sourceOf(row);
  const cell = cellMaker(source);
  const last4 = row.accountNumberLast4 ? String(row.accountNumberLast4).replace(/\D/g, "").slice(-4) || undefined : undefined;
  const subType = row.subType as string | undefined;
  const holdings = readHoldings(row);
  const reading = (sectionId: string, cells: Cells): FFReading => ({
    sectionId,
    fileId: source.fileId,
    cells: compact(cells),
    ...(row.statementDate ? { statementDate: row.statementDate } : {}),
    ...(holdings ? { holdings } : {}),
  });
  const owner = (allowJoint = true) => ownerCell(row, family, source, allowJoint);

  switch (resolveAccountCategory(row)) {
    case "cash":
      return reading("cash", {
        accountName: cell(row.name), currentValue: cell(row.value), last4: cell(last4), owner: owner(),
        custodian: cell(row.custodian), accountType: cell(labelFor(CASH_TYPE_MAP, subType)),
        interestRate: cell(typeof row.growthRate === "number" ? round(row.growthRate * 100, 4) : undefined),
      });
    case "taxable":
      return reading("taxable", {
        accountName: cell(row.name), currentValue: cell(row.value), costBasis: cell(row.basis), last4: cell(last4),
        owner: owner(), custodian: cell(row.custodian), accountType: cell(labelFor(TAXABLE_TYPE_MAP, subType)),
      });
    case "retirement":
      // `basis` on a retirement statement is position cost basis, not the IRA's
      // after-tax (Form 8606) basis — never fill After-tax basis from it.
      return reading("retirement", {
        accountName: cell(row.name), currentValue: cell(row.value), last4: cell(last4), owner: owner(false),
        custodian: cell(row.custodian), accountType: cell(labelFor(RETIRE_TYPE_MAP, subType)),
      });
    case "annuity":
      return reading("annuity", {
        contractName: cell(row.name), cashValue: cell(row.value), costBasis: cell(row.basis), last4: cell(last4),
        owner: owner(), carrier: cell(row.custodian), taxTreatment: cell(labelFor(ANNUITY_TAX_MAP, subType)),
      });
    case "education_savings":
      return reading("edu", {
        accountName: cell(row.name), currentValue: cell(row.value), basis: cell(row.basis), last4: cell(last4),
        owner: owner(), custodian: cell(row.custodian),
        beneficiary: cell(row.beneficiaryName ?? row.beneficiaryNameHint),
        grantor: cell(row.grantorName ?? row.grantorNameHint),
      });
    case "real_estate":
      return reading("realestate", {
        propertyName: cell(row.name), propertyType: cell(labelFor(PROPERTY_TYPE_MAP, subType)),
        currentValue: cell(row.value), costBasis: cell(row.basis), owner: owner(),
        address: cell(row.propertyAddress), annualPropertyTax: cell(row.annualPropertyTax),
      });
    case "business":
      return reading("business", {
        businessName: cell(row.name), businessType: cell(labelFor(BUSINESS_SUBTYPE_MAP, subType)),
        currentValue: cell(row.value), costBasis: cell(row.basis),
      });
    case "life_insurance":
      return reading("life", {
        policyName: cell(row.name), carrier: cell(row.custodian),
        policyType: cell(labelFor(LIFE_SUBTYPE_MAP, subType)), cashValue: cell(row.value),
      });
    case "notes_receivable":
      return reading("notes_rec", { borrower: cell(row.name), currentBalance: cell(row.value), owner: owner() });
    case "stock_options":
      return reading("equity", { company: cell(row.name) });
    default:
      return null;
  }
}

function guessLiabilityType(name: string): string | undefined {
  if (/heloc|home equity/i.test(name)) return "HELOC";
  if (/mortgage/i.test(name)) return "Mortgage";
  if (/\bauto\b|vehicle|car loan/i.test(name)) return "Auto loan";
  if (/student/i.test(name)) return "Student loan";
  if (/credit card|visa|mastercard|amex|discover card/i.test(name)) return "Credit card";
  if (/personal loan/i.test(name)) return "Personal loan";
  return undefined;
}

export function readingFromLiability(row: Annotated<ExtractedLiability>): FFReading {
  const source = sourceOf(row);
  const cell = cellMaker(source);
  const escrow =
    typeof row.totalPayment === "number" && typeof row.monthlyPayment === "number" && row.totalPayment > row.monthlyPayment
      ? round(row.totalPayment - row.monthlyPayment)
      : undefined;
  const term =
    typeof row.startYear === "number" && typeof row.endYear === "number" && row.endYear > row.startYear
      ? row.endYear - row.startYear
      : undefined;
  return {
    sectionId: "liab",
    fileId: source.fileId,
    cells: compact({
      loanName: cell(row.name),
      type: cell(guessLiabilityType(row.name), GUESSED_CONFIDENCE),
      balance: cell(row.balance),
      balanceAsOf: cell(row.balanceAsOfDate?.slice(0, 7)),
      interestRate: cell(typeof row.interestRate === "number" ? round(row.interestRate * 100, 4) : undefined),
      monthlyPI: cell(row.monthlyPayment),
      monthlyEscrow: cell(escrow),
      termYears: cell(term),
      matures: cell(row.maturityDate?.slice(0, 7)),
      propertyName: cell(row.propertyAddress),
    }),
    ...(row.balanceAsOfDate ? { statementDate: row.balanceAsOfDate } : {}),
  };
}

export function readingsFromStatements(input: {
  accounts: Annotated<ExtractedAccount>[];
  excluded: Array<{ row: Annotated<ExtractedAccount>; reason: string }>;
  liabilities: Annotated<ExtractedLiability>[];
  family: OwnerMatchFamilyMember[];
}): FFReading[] {
  const kept = input.accounts.flatMap((a) => readingFromAccount(a, input.family) ?? []);
  const excluded = input.excluded.flatMap(({ row, reason }) => {
    const r = readingFromAccount(row, input.family);
    return r ? [{ ...r, exclude: { reason } }] : [];
  });
  return [...kept, ...excluded, ...input.liabilities.map(readingFromLiability)];
}
