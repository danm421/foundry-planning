import { ownersForYearOrHousehold } from "./owners-or-household";
import { accountSlicesAtYear } from "./account-owner-slices";
import type {
  Account,
  ClientData,
  DrainAttribution,
  EstateTaxResult,
  GiftEvent,
  HypotheticalEstateTax,
  HypotheticalEstateTaxOrdering,
  ProjectionYear,
} from "@/engine/types";
import { inEstateWeight, outOfEstateWeight } from "./in-estate-weights";
import { insuredRetirementYearFor, isPolicyInForce } from "./insurance-in-force";
import type { Ordering } from "./yearly-estate-report";

export interface YearlyLiquidityReportInput {
  /** Only `.years` is read — accepts a full ProjectionResult or a bare
   *  `{ years }` (the Live Solver passes `runProjection` output directly). */
  projection: { years: ProjectionYear[] };
  clientData: ClientData;
  ownerNames: { clientName: string; spouseName: string | null };
  ownerDobs: { clientDob: string | null; spouseDob: string | null };
  /** Death ordering — selects which hypothetical-estate-tax branch the transfer
   *  cost reads from. Must match the ordering the Estate Transfer report uses
   *  for the same context, or the two estate surfaces disagree (F84). Defaults
   *  to `"primaryFirst"` to preserve the prior behaviour for callers (e.g. the
   *  comparison reports) that deliberately pin both surfaces to primaryFirst. */
  ordering?: Ordering;
}

export interface YearlyLiquidityRow {
  year: number;
  ageClient: number | null;
  ageSpouse: number | null;
  insuranceInEstate: number;
  insuranceOutOfEstate: number;
  totalInsuranceBenefit: number;
  totalPortfolioAssets: number;
  totalTransferCost: number;
  surplusDeficitWithPortfolio: number;
  surplusDeficitInsuranceOnly: number;
}

export interface YearlyLiquidityReport {
  rows: YearlyLiquidityRow[];
  totals: {
    insuranceInEstate: number;
    insuranceOutOfEstate: number;
    totalInsuranceBenefit: number;
    totalPortfolioAssets: number;
    totalTransferCost: number;
    surplusDeficitWithPortfolio: number;
    surplusDeficitInsuranceOnly: number;
  };
}

const ZERO_TOTALS: YearlyLiquidityReport["totals"] = {
  insuranceInEstate: 0,
  insuranceOutOfEstate: 0,
  totalInsuranceBenefit: 0,
  totalPortfolioAssets: 0,
  totalTransferCost: 0,
  surplusDeficitWithPortfolio: 0,
  surplusDeficitInsuranceOnly: 0,
};

export function buildYearlyLiquidityReport(
  input: YearlyLiquidityReportInput,
): YearlyLiquidityReport {
  const { projection, clientData, ownerDobs, ordering = "primaryFirst" } = input;

  const clientBirthYear = parseBirthYear(ownerDobs.clientDob);
  const spouseBirthYear = parseBirthYear(ownerDobs.spouseDob);
  const projectionStartYear = clientData.planSettings.planStartYear;
  const giftEvents = clientData.giftEvents ?? [];

  const clientRetirementYear =
    clientBirthYear != null
      ? clientBirthYear + clientData.client.retirementAge
      : null;
  const spouseRetirementYear =
    spouseBirthYear != null && clientData.client.spouseRetirementAge != null
      ? spouseBirthYear + clientData.client.spouseRetirementAge
      : null;

  const rows: YearlyLiquidityRow[] = [];
  for (const yearRow of projection.years) {
    const ht = yearRow.hypotheticalEstateTax;
    if (!ht) continue;
    const branch = pickBranch(ht, ordering);
    if (!branch) continue;
    rows.push(
      buildRow({
        yearRow,
        branch,
        clientBirthYear,
        spouseBirthYear,
        clientData,
        giftEvents,
        projectionStartYear,
        clientRetirementYear,
        spouseRetirementYear,
      }),
    );
  }

  const totals = rows.reduce<YearlyLiquidityReport["totals"]>(
    (acc, r) => ({
      insuranceInEstate: acc.insuranceInEstate + r.insuranceInEstate,
      insuranceOutOfEstate: acc.insuranceOutOfEstate + r.insuranceOutOfEstate,
      totalInsuranceBenefit: acc.totalInsuranceBenefit + r.totalInsuranceBenefit,
      totalPortfolioAssets: acc.totalPortfolioAssets + r.totalPortfolioAssets,
      totalTransferCost: acc.totalTransferCost + r.totalTransferCost,
      surplusDeficitWithPortfolio:
        acc.surplusDeficitWithPortfolio + r.surplusDeficitWithPortfolio,
      surplusDeficitInsuranceOnly:
        acc.surplusDeficitInsuranceOnly + r.surplusDeficitInsuranceOnly,
    }),
    { ...ZERO_TOTALS },
  );

  return { rows, totals };
}

interface RowArgs {
  yearRow: ProjectionYear;
  branch: HypotheticalEstateTaxOrdering;
  clientBirthYear: number | null;
  spouseBirthYear: number | null;
  clientData: ClientData;
  giftEvents: GiftEvent[];
  projectionStartYear: number;
  clientRetirementYear: number | null;
  spouseRetirementYear: number | null;
}

function buildRow(args: RowArgs): YearlyLiquidityRow {
  const {
    yearRow,
    branch,
    clientBirthYear,
    spouseBirthYear,
    clientData,
    giftEvents,
    projectionStartYear,
    clientRetirementYear,
    spouseRetirementYear,
  } = args;

  const { insuranceInEstate, insuranceOutOfEstate } = computeInsurance({
    yearRow,
    clientData,
    giftEvents,
    projectionStartYear,
    clientRetirementYear,
    spouseRetirementYear,
  });
  const totalInsuranceBenefit = insuranceInEstate + insuranceOutOfEstate;
  const totalPortfolioAssets = computePortfolioAssets({
    yearRow,
    clientData,
    giftEvents,
    projectionStartYear,
  });
  const totalTransferCost = transferCost(branch);

  return {
    year: yearRow.year,
    ageClient: clientBirthYear ? yearRow.year - clientBirthYear : null,
    ageSpouse: spouseBirthYear ? yearRow.year - spouseBirthYear : null,
    insuranceInEstate,
    insuranceOutOfEstate,
    totalInsuranceBenefit,
    totalPortfolioAssets,
    totalTransferCost,
    surplusDeficitWithPortfolio:
      totalPortfolioAssets + totalInsuranceBenefit - totalTransferCost,
    surplusDeficitInsuranceOnly: totalInsuranceBenefit - totalTransferCost,
  };
}

interface InsuranceArgs {
  yearRow: ProjectionYear;
  clientData: ClientData;
  giftEvents: GiftEvent[];
  projectionStartYear: number;
  clientRetirementYear: number | null;
  spouseRetirementYear: number | null;
}

/** Walks `parentAccountId` up from `account` to its top-level ancestor (the
 *  account itself when it has no parent). Cycle-safe via a visited set. */
function topLevelOwnerAccount(account: Account, accounts: Account[]): Account {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const seen = new Set<string>();
  let cur = account;
  while (cur.parentAccountId != null && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = byId.get(cur.parentAccountId);
    if (!parent) break;
    cur = parent;
  }
  return cur;
}

function computeInsurance(args: InsuranceArgs): {
  insuranceInEstate: number;
  insuranceOutOfEstate: number;
} {
  const {
    yearRow,
    clientData,
    giftEvents,
    projectionStartYear,
    clientRetirementYear,
    spouseRetirementYear,
  } = args;

  let inEstate = 0;
  let outOfEstate = 0;

  for (const account of clientData.accounts) {
    if (account.category !== "life_insurance" || !account.lifeInsurance) continue;

    const insuredRetirementYear = insuredRetirementYearFor(
      account,
      clientRetirementYear,
      spouseRetirementYear,
    );
    if (!isPolicyInForce(account, yearRow.year, insuredRetirementYear)) continue;

    // A life-insurance account that is a business CHILD carries no
    // account_owners rows by design, so reading its own owners would hit the
    // household fallback and book a trust-owned business's policy as 100%
    // household — its face value is real death benefit, so it isn't skipped
    // like a cash/taxable child; instead it's re-owned from its top-level
    // business parent. A top-level policy is unaffected (walk is a no-op).
    const ownerAccount =
      account.parentAccountId != null
        ? topLevelOwnerAccount(account, clientData.accounts)
        : account;
    const owners = ownersForYearOrHousehold(
      ownerAccount,
      giftEvents,
      yearRow.year,
      projectionStartYear,
    );
    const face = account.lifeInsurance.faceValue;
    for (const owner of owners) {
      inEstate += face * owner.percent * inEstateWeight(clientData, owner);
      outOfEstate += face * owner.percent * outOfEstateWeight(clientData, owner);
    }
  }

  return { insuranceInEstate: inEstate, insuranceOutOfEstate: outOfEstate };
}

const LIQUID_CATEGORIES: ReadonlySet<Account["category"]> = new Set([
  "taxable",
  "cash",
  "retirement",
]);

interface PortfolioArgs {
  yearRow: ProjectionYear;
  clientData: ClientData;
  giftEvents: GiftEvent[];
  projectionStartYear: number;
}

function computePortfolioAssets(args: PortfolioArgs): number {
  const { yearRow, clientData, giftEvents, projectionStartYear } = args;
  let total = 0;
  for (const account of clientData.accounts) {
    // Business child accounts roll into their parent — skip them so their
    // value isn't counted twice. They also carry NO account_owners rows by
    // design, so left in place they'd hit the household ownership fallback
    // and book a trust-owned business's operating cash as 100% household
    // liquid. `LIQUID_CATEGORIES` excludes `business` itself (a business is
    // not a liquid asset either way), but a `cash`/`taxable` child sails
    // straight through that filter without this guard.
    if (account.parentAccountId != null) continue;
    if (!LIQUID_CATEGORIES.has(account.category)) continue;
    const ledger = yearRow.accountLedgers?.[account.id];
    const balance = ledger?.endingValue ?? 0;
    // A drained (or will-split) pool can still have slices a death carved out
    // of it; only an account with neither has nothing to count.
    const hasCarved = [...(yearRow.accountOwners?.values() ?? [])].some(
      (rec) => rec.sliceOf === account.id,
    );
    if (balance === 0 && !hasCarved) continue;
    // Locked-share resolution: entity slices come from the engine's
    // entityAccountSharesEoY (untouched by household withdrawals), family
    // slices come from familyAccountSharesEoY when populated, else the
    // family pool (balance − Σ entity locked − gifted-away) split by
    // authored percent. Shared with the gross-estate and balance-sheet
    // reports so all three agree on the same dollars.
    const slices = accountSlicesAtYear({
      account,
      yearRow,
      valueOf: (id) => yearRow.accountLedgers?.[id]?.endingValue ?? 0,
      fallbackOwners: () =>
        ownersForYearOrHousehold(account, giftEvents, yearRow.year, projectionStartYear),
    });

    for (const { owner, value: sliceValue } of slices) {
      const w = inEstateWeight(clientData, owner);
      if (w <= 0) continue;
      total += sliceValue * w;
    }
  }
  return total;
}

function transferCost(branch: HypotheticalEstateTaxOrdering): number {
  return (
    branchDeathCost(branch.firstDeath) +
    (branch.finalDeath ? branchDeathCost(branch.finalDeath) : 0)
  );
}

function branchDeathCost(d: EstateTaxResult): number {
  // `totalTaxesAndExpenses` is federal + state + admin + probate. The engine drains
  // liquid assets for creditor debt and IRD tax too (final-death.ts), so a
  // transfer cost that omits them understates the real liquidity demand and can
  // report a false surplus (audit F6). Matches the transfer report's "Debts
  // Paid" reduction line so the two estate surfaces agree.
  return (
    d.totalTaxesAndExpenses +
    sumDrainKind(d.drainAttributions, "debts_paid") +
    sumDrainKind(d.drainAttributions, "ird_tax")
  );
}

function sumDrainKind(
  attributions: DrainAttribution[] | undefined,
  kind: DrainAttribution["drainKind"],
): number {
  if (!attributions) return 0;
  let total = 0;
  for (const a of attributions) {
    if (a.drainKind === kind) total += a.amount;
  }
  return total;
}

// Select the death-ordering branch, matching yearly-estate-report's pickBranch:
// honour the requested ordering when that branch exists, else fall back to the
// other available branch (so single-death plans that only carry one branch
// still resolve).
function pickBranch(
  ht: HypotheticalEstateTax,
  ordering: Ordering,
): HypotheticalEstateTaxOrdering | null {
  if (ordering === "spouseFirst") return ht.spouseFirst ?? ht.primaryFirst ?? null;
  return ht.primaryFirst ?? ht.spouseFirst ?? null;
}

function parseBirthYear(dob: string | null): number | null {
  if (!dob) return null;
  const y = parseInt(dob.slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}
