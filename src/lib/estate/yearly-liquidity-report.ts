import { ownersForYear } from "@/engine/ownership";
import type {
  Account,
  ClientData,
  DrainAttribution,
  EstateTaxResult,
  GiftEvent,
  HypotheticalEstateTax,
  HypotheticalEstateTaxOrdering,
  ProjectionResult,
  ProjectionYear,
} from "@/engine/types";
import { inEstateWeight, outOfEstateWeight } from "./in-estate-weights";
import { isPolicyInForce } from "./insurance-in-force";

export interface YearlyLiquidityReportInput {
  projection: ProjectionResult;
  clientData: ClientData;
  ownerNames: { clientName: string; spouseName: string | null };
  ownerDobs: { clientDob: string | null; spouseDob: string | null };
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
  const { projection, clientData, ownerDobs } = input;

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
    const branch = pickBranch(ht);
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

    const insuredRetirementYear = resolveInsuredRetirementYear(
      account,
      clientRetirementYear,
      spouseRetirementYear,
    );
    if (!isPolicyInForce(account, yearRow.year, insuredRetirementYear)) continue;

    const owners = ownersForYear(
      account,
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
    if (!LIQUID_CATEGORIES.has(account.category)) continue;
    const ledger = yearRow.accountLedgers?.[account.id];
    const balance = ledger?.endingValue ?? 0;
    if (balance === 0) continue;
    const owners = ownersForYear(
      account,
      giftEvents,
      yearRow.year,
      projectionStartYear,
    );

    // Locked-share resolution: entity slices come from the engine's
    // entityAccountSharesEoY (untouched by household withdrawals), family
    // slices come from familyAccountSharesEoY when populated, else the
    // family pool (balance − Σ entity locked) split by authored percent.
    let totalEntityShare = 0;
    let familyPercentTotal = 0;
    for (const o of owners) {
      if (o.kind === "entity") {
        const locked = yearRow.entityAccountSharesEoY?.get(o.entityId)?.get(account.id);
        totalEntityShare += locked ?? balance * o.percent;
      } else {
        familyPercentTotal += o.percent;
      }
    }
    const familyPool = Math.max(0, balance - totalEntityShare);

    for (const owner of owners) {
      const w = inEstateWeight(clientData, owner);
      if (w <= 0) continue;
      let sliceValue: number;
      if (owner.kind === "entity") {
        const locked = yearRow.entityAccountSharesEoY?.get(owner.entityId)?.get(account.id);
        sliceValue = locked ?? balance * owner.percent;
      } else {
        const lockedFm = yearRow.familyAccountSharesEoY
          ?.get(owner.familyMemberId)
          ?.get(account.id);
        if (lockedFm != null) {
          sliceValue = lockedFm;
        } else {
          sliceValue =
            familyPercentTotal > 0
              ? familyPool * (owner.percent / familyPercentTotal)
              : balance * owner.percent;
        }
      }
      total += sliceValue * w;
    }
  }
  return total;
}

function resolveInsuredRetirementYear(
  account: Account,
  clientRetirementYear: number | null,
  spouseRetirementYear: number | null,
): number | null {
  switch (account.insuredPerson) {
    case "client":
      return clientRetirementYear;
    case "spouse":
      return spouseRetirementYear;
    case "joint":
      // Policy lapses only when BOTH have retired, so use the later year.
      if (clientRetirementYear == null) return spouseRetirementYear;
      if (spouseRetirementYear == null) return clientRetirementYear;
      return Math.max(clientRetirementYear, spouseRetirementYear);
    default:
      return null;
  }
}

function transferCost(branch: HypotheticalEstateTaxOrdering): number {
  return (
    branchDeathCost(branch.firstDeath) +
    (branch.finalDeath ? branchDeathCost(branch.finalDeath) : 0)
  );
}

function branchDeathCost(d: EstateTaxResult): number {
  return d.totalTaxesAndExpenses + sumDrainKind(d.drainAttributions, "ird_tax");
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

function pickBranch(
  ht: HypotheticalEstateTax,
): HypotheticalEstateTaxOrdering | null {
  return ht.primaryFirst ?? ht.spouseFirst ?? null;
}

function parseBirthYear(dob: string | null): number | null {
  if (!dob) return null;
  const y = parseInt(dob.slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}
