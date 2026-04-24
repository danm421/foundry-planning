import type {
  ClientData,
  ProjectionYear,
  AccountLedger,
  AccountLedgerEntry,
  Liability,
  EntitySummary,
  Account,
  WithdrawalPriority,
  PlanSettings,
  DeductionBreakdown,
  Income,
} from "./types";
import { computeIncome } from "./income";
import { computeExpenses } from "./expenses";
import { computeLiabilities } from "./liabilities";
import {
  buildLiabilitySchedule,
  buildLiabilitySchedules,
  scheduleBoYBalance,
  type LiabilityScheduleMap,
} from "./liability-schedules";
import { calculateTaxYearBracket, calculateTaxYearFlat, makeEmptyTaxParams } from "./tax";
import { createTaxResolver } from "../lib/tax/resolver";
import type { TaxYearParameters, FilingStatus } from "../lib/tax/types";
import {
  deriveAboveLineFromSavings,
  deriveAboveLineFromExpenses,
  deriveItemizedFromExpenses,
  deriveMortgageInterestFromLiabilities,
  derivePropertyTaxFromAccounts,
  sumItemizedFromEntries,
  aggregateDeductions,
  saltCap,
} from "../lib/tax/derive-deductions";
import { applySavingsRules, computeEmployerMatch, resolveContributionAmount } from "./savings";
import { applyContributionLimits, computeMaxContribution, resolveAgeInYear } from "./contribution-limits";
import { executeWithdrawals } from "./withdrawal";
import { calculateRMD } from "./rmd";
import { applyTransfers } from "./transfers";
import { applyAssetSales, applyAssetPurchases, _resetSyntheticIdCounter } from "./asset-transactions";
import {
  computeFirstDeathYear,
  computeFinalDeathYear,
  identifyDeceased,
  identifyFinalDeceased,
  effectiveFilingStatus,
  applyFirstDeath,
  applyFinalDeath,
} from "./death-event";
import { computeHypotheticalEstateTax } from "./what-if/hypothetical-estate-tax";
import { calcSeca } from "../lib/tax/fica";

// Map legacy income type to the new tax type categories.
function legacyTaxType(
  incomeType: string
): "earned_income" | "ordinary_income" | "dividends" | "capital_gains" | "qbi" | "tax_exempt" | "stcg" {
  switch (incomeType) {
    case "salary": return "earned_income";
    case "social_security": return "ordinary_income";
    case "business": return "ordinary_income";
    case "deferred": return "ordinary_income";
    case "capital_gains": return "capital_gains";
    case "trust": return "ordinary_income";
    default: return "ordinary_income";
  }
}

// Tax-efficiency ranking applied when the user hasn't configured a withdrawal strategy.
// Lower number = tapped first. Household checking is excluded because it's the target
// account, not a source. Real estate / business / life-insurance accounts are skipped
// (they can't be liquidated cleanly).
function defaultWithdrawalPriorityFor(acct: Account): number | null {
  if (acct.ownerEntityId != null) return null;
  if (acct.isDefaultChecking) return null;
  if (acct.category === "cash") return 1;
  if (acct.category === "taxable") return 2;
  if (acct.category === "retirement") {
    if (acct.subType === "roth_ira" || acct.subType === "roth_401k") return 4;
    // traditional_ira, 401k, 529, deferred, other → tax-deferred bucket
    return 3;
  }
  return null;
}

function buildDefaultWithdrawalStrategy(
  accounts: Account[],
  planSettings: PlanSettings
): WithdrawalPriority[] {
  const strategy: WithdrawalPriority[] = [];
  for (const acct of accounts) {
    const priority = defaultWithdrawalPriorityFor(acct);
    if (priority == null) continue;
    strategy.push({
      accountId: acct.id,
      priorityOrder: priority,
      startYear: planSettings.planStartYear,
      endYear: planSettings.planEndYear,
    });
  }
  // Within a priority bucket, draw from the largest balance first so we don't empty a
  // small account on year one and then have to re-sort order to reach the next tier.
  strategy.sort((a, b) => {
    if (a.priorityOrder !== b.priorityOrder) return a.priorityOrder - b.priorityOrder;
    const va = accounts.find((x) => x.id === a.accountId)?.value ?? 0;
    const vb = accounts.find((x) => x.id === b.accountId)?.value ?? 0;
    return vb - va;
  });
  return strategy;
}

// Build a per-year §2503(b) annual gift exclusion lookup from the loaded tax-year
// rows. Drizzle returns pg-numeric columns as strings; we coerce to number once at
// the engine boundary so the death-event module can keep its pure shape
// `Record<number, number>`.
function buildAnnualExclusionsMap(
  rows: Array<{ year: number; giftAnnualExclusion?: string | null }>,
): Record<number, number> {
  const map: Record<number, number> = {};
  for (const r of rows) {
    if (r.giftAnnualExclusion != null) {
      map[r.year] = parseFloat(r.giftAnnualExclusion);
    }
  }
  return map;
}

export interface ProjectionOptions {
  /**
   * Monte Carlo return injection. When provided and the override returns a
   * finite number, that rate is used instead of `acct.growthRate` for the
   * account's growth pass in that year. When the override returns `undefined`,
   * the account falls back to its fixed `growthRate` (per the eMoney
   * whitepaper's "custom growth rates remain fixed for Monte Carlo" rule).
   *
   * Left unset, `runProjection` behaves exactly as before — deterministic
   * path is byte-identical.
   */
  returnsOverride?: (year: number, accountId: string) => number | undefined;
}

export function runProjection(data: ClientData, options?: ProjectionOptions): ProjectionYear[] {
  const { client, planSettings } = data;
  const years: ProjectionYear[] = [];

  const taxYearRows: TaxYearParameters[] = data.taxYearRows ?? [];
  if (planSettings.taxEngineMode === "bracket" && taxYearRows.length === 0) {
    console.warn(
      "[tax engine] Bracket mode selected but no tax_year_parameters rows available. " +
      "Falling back to flat mode. Run `npm run seed:tax-data` to populate."
    );
  }
  const taxResolver = taxYearRows.length > 0
    ? createTaxResolver(taxYearRows, {
        taxInflationRate: planSettings.taxInflationRate != null
          ? planSettings.taxInflationRate
          : planSettings.inflationRate,
        ssWageGrowthRate: planSettings.ssWageGrowthRate != null
          ? planSettings.ssWageGrowthRate
          : planSettings.inflationRate + 0.005,
      })
    : null;

  // Entity lookup for out-of-estate treatment rules.
  const entityMap: Record<string, EntitySummary> = {};
  for (const e of data.entities ?? []) entityMap[e.id] = e;

  const isGrantorEntity = (entityId: string | undefined): boolean =>
    entityId != null && entityMap[entityId]?.isGrantor === true;

  // Effective withdrawal strategy. If the user hasn't configured anything, fall back
  // to a tax-efficient default: Cash → Taxable → Tax-Deferred → Roth. Illiquid
  // categories (real estate, business, life insurance) and default-checking accounts
  // are skipped. The household checking is always the target, never a source.
  const effectiveWithdrawalStrategy =
    data.withdrawalStrategy.length > 0
      ? data.withdrawalStrategy
      : buildDefaultWithdrawalStrategy(data.accounts, planSettings);

  // Default checking accounts — household and one per entity. When present, all
  // household cash flows through the household checking; entity cash through the
  // entity's own checking. When the household checking is absent we fall back to
  // the legacy surplus/deficit model (preserves tests + pre-migration data).
  const defaultChecking = data.accounts.find(
    (a) => a.isDefaultChecking && a.ownerEntityId == null
  );
  const hasChecking = defaultChecking != null;
  const entityCheckingByEntityId: Record<string, string> = {};
  for (const a of data.accounts) {
    if (a.isDefaultChecking && a.ownerEntityId) {
      entityCheckingByEntityId[a.ownerEntityId] = a.id;
    }
  }

  // Resolve the cash account that an income/expense/liability should settle against:
  // an explicit override wins, otherwise fall back to the default checking for the
  // appropriate owner.
  const resolveCashAccount = (
    ownerEntityId: string | undefined,
    overrideId?: string
  ): string | undefined => {
    if (overrideId) return overrideId;
    if (ownerEntityId) return entityCheckingByEntityId[ownerEntityId];
    return defaultChecking?.id;
  };

  // Mutable state that carries across years
  const accountBalances: Record<string, number> = {};
  for (const acct of data.accounts) {
    accountBalances[acct.id] = acct.value;
  }

  // Basis tracking for transfers and sales
  const basisMap: Record<string, number> = {};
  for (const acct of data.accounts) {
    basisMap[acct.id] = acct.basis;
  }

  // Mutable accounts list — techniques can add/remove accounts
  let workingAccounts = [...data.accounts];

  // Reset synthetic ID counter for technique-created assets
  _resetSyntheticIdCounter();

  // Monthly amortization schedule per liability, keyed by id. Built once at
  // init for pre-existing liabilities and extended inline when BoY purchases
  // create new mortgages mid-projection. Authoritative source for BoY/EoY
  // balances, payments, and interest — replaces the previous simplified
  // annual amortization so engine numbers match the balance sheet / tab.
  const liabilitySchedules: LiabilityScheduleMap = buildLiabilitySchedules(
    data.liabilities,
  );

  // Starting balance for each liability is the BoY balance at planStartYear
  // from its schedule — not the raw DB balance, which may be as-of a
  // different year (e.g. loan origination).
  let currentLiabilities: Liability[] = data.liabilities.map((l) => {
    const sched = liabilitySchedules.get(l.id);
    const boyBalance = sched
      ? scheduleBoYBalance(sched, planSettings.planStartYear)
      : l.balance;
    return { ...l, balance: boyBalance };
  });

  const clientBirthYear = parseInt(client.dateOfBirth.slice(0, 4), 10);
  const spouseBirthYear = client.spouseDob
    ? parseInt(client.spouseDob.slice(0, 4), 10)
    : undefined;

  const firstDeathYear = computeFirstDeathYear(
    client,
    planSettings.planStartYear,
    planSettings.planEndYear,
  );
  const firstDeathDeceased =
    firstDeathYear != null ? identifyDeceased(client, firstDeathYear) : null;
  const firstDeathSurvivor: "client" | "spouse" | null =
    firstDeathDeceased === "client" ? "spouse" : firstDeathDeceased === "spouse" ? "client" : null;

  const finalDeathYear = computeFinalDeathYear(
    client,
    planSettings.planStartYear,
    planSettings.planEndYear,
  );
  const finalDeceased: "client" | "spouse" | null =
    finalDeathYear != null
      ? identifyFinalDeceased(client, firstDeathDeceased)
      : null;

  // DSUE generated by the first death is stashed here so the final-death call
  // can claim it via §2010(c)(4) portability. Stays 0 for the single-filer path
  // (no first-death event fires, so no DSUE is ever generated).
  let stashedDSUE = 0;

  let currentIncomes: Income[] = [...data.incomes];

  const annualExclusionsByYear = buildAnnualExclusionsMap(data.taxYearRows ?? []);

  for (
    let year = planSettings.planStartYear;
    year <= planSettings.planEndYear;
    year++
  ) {
    const ages = {
      client: year - clientBirthYear,
      spouse: spouseBirthYear != null ? year - spouseBirthYear : undefined,
    };

    // 1. Compute income breakdowns. Household and grantor-trust streams are kept
    // separate because grantor income flows to the entity checking but is still
    // taxable at the household rate.
    const income = computeIncome(
      currentIncomes,
      year,
      client,
      (inc) => inc.ownerEntityId == null
    );
    const grantorIncome = computeIncome(
      currentIncomes,
      year,
      client,
      (inc) => inc.ownerEntityId != null && isGrantorEntity(inc.ownerEntityId)
    );

    // 2. Household expenses (entity-owned expenses are paid by the entity).
    // Pass only real expenses — synthetic property-tax expenses (built later,
    // post-BoY transactions) are tracked separately in the realEstate bucket.
    const expenseBreakdown = computeExpenses(
      data.expenses,
      year,
      (exp) => exp.ownerEntityId == null
    );

    // Initialize per-account ledgers with the year-start balances. Ledgers are
    // populated first so that BoY sales/purchases (next) can append their entries
    // before the growth pass adds its own.
    const accountLedgers: Record<string, AccountLedger> = {};
    for (const acct of workingAccounts) {
      const beginningValue = accountBalances[acct.id] ?? 0;
      accountLedgers[acct.id] = {
        beginningValue,
        growth: 0,
        contributions: 0,
        distributions: 0,
        rmdAmount: 0,
        fees: 0,
        endingValue: beginningValue,
        entries: [],
      };
    }

    // Snapshot BoY state for UI previews (sale-form autofill). Captured before
    // sales/purchases so a UI reading year N sees the pre-transaction values.
    const accountBasisBoY: Record<string, number> = {};
    for (const acct of workingAccounts) {
      accountBasisBoY[acct.id] = basisMap[acct.id] ?? acct.basis;
    }
    // BoY balance pulled from each liability's schedule at `year`. For loans
    // originated before planStartYear this picks up the authoritative mid-
    // schedule balance; for loans that don't originate until a later year the
    // schedule lookup still returns the correct value (or zero after payoff).
    const liabilityBalancesBoY: Record<string, number> = {};
    for (const liab of currentLiabilities) {
      const sched = liabilitySchedules.get(liab.id);
      const boy = sched ? scheduleBoYBalance(sched, year) : liab.balance;
      liabilityBalancesBoY[liab.id] = boy;
      // Keep liab.balance aligned with BoY so applyAssetSales (which reads
      // linkedMortgage.balance) pays off the correct amount.
      liab.balance = boy;
    }

    // ── BoY: Asset Sales ─────────────────────────────────────────────────────
    // Sales happen on the first day of the year: the sold asset doesn't earn
    // growth this year, and sale proceeds land in the cash account in time to
    // earn the year's cash growth.
    let saleResult = {
      capitalGains: 0,
      homeSaleExclusionTotal: 0,
      removedAccountIds: [] as string[],
      removedLiabilityIds: [] as string[],
      breakdown: [] as { transactionId: string; accountId: string; saleValue: number; basis: number; transactionCosts: number; netProceeds: number; capitalGain: number; homeSaleExclusionApplied: number; taxableCapitalGain: number; mortgagePaidOff: number; proceedsAccountId: string }[],
    };
    if (data.assetTransactions && data.assetTransactions.length > 0) {
      const sales = data.assetTransactions.filter((t) => t.type === "sell");
      if (sales.length > 0) {
        saleResult = applyAssetSales({
          sales,
          accounts: workingAccounts,
          liabilities: currentLiabilities,
          accountBalances,
          basisMap,
          accountLedgers,
          year,
          defaultCheckingId: defaultChecking?.id ?? "",
          filingStatus: effectiveFilingStatus(
            (client.filingStatus ?? "single") as FilingStatus,
            firstDeathYear,
            year,
          ),
        });

        if (saleResult.removedAccountIds.length > 0) {
          const removed = new Set(saleResult.removedAccountIds);
          workingAccounts = workingAccounts.filter((a) => !removed.has(a.id));
        }

        if (saleResult.removedLiabilityIds.length > 0) {
          const removed = new Set(saleResult.removedLiabilityIds);
          currentLiabilities = currentLiabilities.filter((l) => !removed.has(l.id));
        }
      }
    }

    // ── BoY: Asset Purchases ─────────────────────────────────────────────────
    // Purchases happen on the first day of the year: equity leaves the funding
    // account immediately, and the newly-bought asset earns a full year of
    // growth. If a paired sale funded the purchase, its proceeds are already in
    // the cash account from the sale step above.
    let purchaseBreakdown: { transactionId: string; name: string; equity: number; purchasePrice: number; mortgageAmount: number; fundingAccountId: string; liabilityId?: string; liabilityName?: string }[] = [];
    if (data.assetTransactions && data.assetTransactions.length > 0) {
      const purchases = data.assetTransactions.filter((t) => t.type === "buy");
      if (purchases.length > 0) {
        const purchaseResult = applyAssetPurchases({
          purchases,
          accounts: workingAccounts,
          liabilities: currentLiabilities,
          accountBalances,
          basisMap,
          accountLedgers,
          year,
          defaultCheckingId: defaultChecking?.id ?? "",
        });

        purchaseBreakdown = purchaseResult.breakdown;
        for (const newAcct of purchaseResult.newAccounts) {
          workingAccounts.push(newAcct);
        }
        for (const newLiab of purchaseResult.newLiabilities) {
          currentLiabilities.push(newLiab);
          // Build a schedule for the new mortgage starting at its origination
          // year (== this projection year). BoY balance == mortgageAmount.
          liabilitySchedules.set(newLiab.id, buildLiabilitySchedule(newLiab));
        }
      }
    }

    // Inject synthetic property-tax expenses for real estate accounts. Built
    // after BoY sales/purchases so a sold property is excluded and a newly-
    // bought property contributes a full year of property tax.
    const syntheticExpenses: typeof data.expenses = [];
    for (const acct of workingAccounts) {
      if (acct.category !== "real_estate") continue;
      const propTax = acct.annualPropertyTax ?? 0;
      if (propTax <= 0) continue;
      const elapsed = year - planSettings.planStartYear;
      const inflated = propTax * Math.pow(1 + (acct.propertyTaxGrowthRate ?? 0.03), Math.max(0, elapsed));
      syntheticExpenses.push({
        id: `synth-proptax-${acct.id}`,
        type: "other",
        name: `Property Tax – ${acct.name}`,
        annualAmount: inflated,
        startYear: planSettings.planStartYear,
        endYear: planSettings.planEndYear,
        growthRate: 0, // already inflated
      });
    }
    const allExpenses = [...data.expenses, ...syntheticExpenses];

    // 3. Liability payments — amortize all liabilities (so balances roll forward),
    // capture the household total for reporting, and keep the per-liability map
    // so entity liability payments can be routed to entity checking below. Runs
    // after BoY sales/purchases so sold-asset mortgages are already removed and
    // new mortgages from purchases are included for a full year of payments.
    const liabResult = computeLiabilities(
      currentLiabilities,
      year,
      (liab) => liab.ownerEntityId == null,
      liabilitySchedules,
    );
    currentLiabilities = liabResult.updatedLiabilities;

    // 4. Grow every account (post-BoY: sold accounts are gone, newly-bought
    // accounts are included). When the account has a realization model, split
    // growth into tax buckets: OI, QDiv, STCG, LTCG, Tax-Exempt. Turnover %
    // determines the ST/LT CG split. Taxable amounts are added to the year's
    // tax detail; basis is increased for everything except LTCG.
    let realizationOI = 0;
    let realizationQDiv = 0;
    let realizationSTCG = 0;
    const realizationBySource: Record<string, { type: string; amount: number }> = {};

    for (const acct of workingAccounts) {
      const currentBalance = accountBalances[acct.id] ?? 0;
      const overriddenRate = options?.returnsOverride?.(year, acct.id);
      const effectiveGrowthRate =
        overriddenRate != null && Number.isFinite(overriddenRate)
          ? overriddenRate
          : acct.growthRate;
      const growth = currentBalance * effectiveGrowthRate;

      // Defensive: ensure a ledger exists (applyAssetPurchases initializes one
      // for new accounts; this covers any edge case where it didn't).
      if (!accountLedgers[acct.id]) {
        accountLedgers[acct.id] = {
          beginningValue: currentBalance,
          growth: 0,
          contributions: 0,
          distributions: 0,
          rmdAmount: 0,
          fees: 0,
          endingValue: currentBalance,
          entries: [],
        };
      }

      if (growth === 0) continue;

      let growthDetail: AccountLedger["growthDetail"];

      if (acct.realization) {
        const r = acct.realization;
        const oi = growth * r.pctOrdinaryIncome;
        const qdiv = growth * r.pctQualifiedDividends;
        const rawLtcg = growth * r.pctLtCapitalGains;
        const stcg = rawLtcg * r.turnoverPct;
        const ltcg = rawLtcg - stcg;
        const taxExempt = growth * r.pctTaxExempt;
        // Basis increases for everything EXCEPT LTCG (unrealized appreciation)
        const basisIncrease = oi + qdiv + stcg + taxExempt;

        growthDetail = { ordinaryIncome: oi, qualifiedDividends: qdiv, stCapitalGains: stcg, ltCapitalGains: ltcg, taxExempt, basisIncrease };

        // Only taxable accounts generate current-year tax from realization.
        // Retirement accounts defer all tax until withdrawal; cash accounts
        // are always 100% OI but that's baked into the realization model.
        if (acct.category === "taxable" || acct.category === "cash") {
          realizationOI += oi;
          realizationQDiv += qdiv;
          realizationSTCG += stcg;
          if (oi > 0) realizationBySource[`${acct.id}:oi`] = { type: "ordinary_income", amount: oi };
          if (qdiv > 0) realizationBySource[`${acct.id}:qdiv`] = { type: "dividends", amount: qdiv };
          if (stcg > 0) realizationBySource[`${acct.id}:stcg`] = { type: "stcg", amount: stcg };
        }
      }

      accountLedgers[acct.id].growth += growth;
      accountLedgers[acct.id].endingValue += growth;
      accountLedgers[acct.id].entries.push({
        category: "growth",
        label: `Growth (${(effectiveGrowthRate * 100).toFixed(2)}%)`,
        amount: growth,
      });
      if (growthDetail) accountLedgers[acct.id].growthDetail = growthDetail;

      accountBalances[acct.id] = currentBalance + growth;
    }

    // Per-account cash deltas plus per-account entry lists for this year. A "credit"
    // with a positive amount is an inflow; negative is an outflow. The entries list
    // gives the ledger modal something to show beyond the summed totals.
    const cashDelta: Record<string, number> = {};
    const pendingEntries: Record<string, AccountLedgerEntry[]> = {};
    const creditCash = (
      acctId: string | undefined,
      amount: number,
      entry?: Omit<AccountLedgerEntry, "amount">
    ) => {
      if (!acctId || amount === 0) return;
      cashDelta[acctId] = (cashDelta[acctId] ?? 0) + amount;
      if (entry) {
        (pendingEntries[acctId] ??= []).push({ ...entry, amount });
      }
    };

    // ── Apply Transfers ─────────────────────────────────────────────────────
    let transferResult = {
      taxableOrdinaryIncome: 0,
      capitalGains: 0,
      earlyWithdrawalPenalty: 0,
      byTransfer: {} as Record<string, { amount: number; label: string }>,
    };
    if (data.transfers && data.transfers.length > 0) {
      transferResult = applyTransfers({
        transfers: data.transfers,
        accounts: workingAccounts,
        accountBalances,
        basisMap,
        accountLedgers,
        year,
        ownerAges: { client: ages.client, spouse: ages.spouse },
      });
    }

    // 4b. RMDs. Source account balance is decremented; the cash lands in the
    // appropriate checking (household or entity) via cashDelta. Tax treatment:
    // household → household tax; grantor entity → household tax; other entity →
    // no household tax (entity handles its own, not modeled yet).
    let householdRmdIncome = 0;
    let grantorRmdTaxable = 0;
    const rmdBySource: Record<string, { type: string; amount: number }> = {};
    for (const acct of workingAccounts) {
      if (!acct.rmdEnabled) continue;
      let ownerBirthYear: number;
      if (acct.owner === "spouse" && spouseBirthYear != null) {
        ownerBirthYear = spouseBirthYear;
      } else {
        ownerBirthYear = clientBirthYear;
      }
      const ownerAge = year - ownerBirthYear;
      // IRS RMD rule: divisor × prior-year-Dec-31 balance. That's BoY of this
      // year (before growth/transfers), captured on the ledger as
      // `beginningValue`. Using the post-growth current balance slightly
      // overstates the required amount in up markets.
      const rmdBasis = accountLedgers[acct.id]?.beginningValue ?? accountBalances[acct.id] ?? 0;
      const currentBalance = accountBalances[acct.id] ?? 0;
      const rmd = Math.min(currentBalance, calculateRMD(rmdBasis, ownerAge, ownerBirthYear));
      if (rmd <= 0) continue;

      accountBalances[acct.id] = currentBalance - rmd;
      if (accountLedgers[acct.id]) {
        accountLedgers[acct.id].rmdAmount = rmd;
        accountLedgers[acct.id].distributions += rmd;
        accountLedgers[acct.id].endingValue -= rmd;
        accountLedgers[acct.id].entries.push({
          category: "rmd",
          label: `RMD distribution (age ${ownerAge})`,
          amount: -rmd,
        });
      }

      const rmdLabel = `RMD from ${acct.name}`;
      if (acct.ownerEntityId == null) {
        householdRmdIncome += rmd;
        rmdBySource[`${acct.id}:rmd`] = { type: "ordinary_income", amount: rmd };
        creditCash(defaultChecking?.id, rmd, { category: "rmd", label: rmdLabel, sourceId: acct.id });
      } else {
        creditCash(entityCheckingByEntityId[acct.ownerEntityId], rmd, {
          category: "rmd",
          label: rmdLabel,
          sourceId: acct.id,
        });
        if (isGrantorEntity(acct.ownerEntityId)) {
          grantorRmdTaxable += rmd;
          rmdBySource[`${acct.id}:rmd`] = { type: "ordinary_income", amount: rmd };
        }
      }
    }

    // 5. Compute taxable income total and per-category tax detail.
    const taxableIncome =
      income.salaries +
      income.business +
      income.deferred +
      income.capitalGains +
      income.trust +
      householdRmdIncome +
      grantorIncome.salaries +
      grantorIncome.business +
      grantorIncome.deferred +
      grantorIncome.capitalGains +
      grantorIncome.trust +
      grantorRmdTaxable +
      realizationOI +
      realizationQDiv +
      realizationSTCG +
      transferResult.taxableOrdinaryIncome +
      transferResult.capitalGains +
      saleResult.capitalGains;
    // Build per-year tax detail breakdown. Income items use their taxType when
    // set, otherwise fall back to the legacy type-based mapping.
    const taxDetail: ProjectionYear["taxDetail"] = {
      earnedIncome: 0,
      ordinaryIncome: realizationOI,
      dividends: realizationQDiv,
      capitalGains: 0,
      stCapitalGains: realizationSTCG,
      qbi: 0,
      taxExempt: 0,
      bySource: { ...realizationBySource, ...rmdBySource },
    };
    // Map income entries to tax categories. Social Security is intentionally
    // excluded from this loop: `socialSecurityGross` is passed separately into
    // the bracket engine, which runs `calcTaxableSocialSecurity` against it
    // and adds the taxable portion to `totalIncome`. Adding SS here (as the
    // legacy mapping did, via legacyTaxType("social_security") → ordinary)
    // double-counted it for every retiree in bracket mode.
    for (const inc of currentIncomes) {
      if (year < inc.startYear || year > inc.endYear) continue;
      if (inc.ownerEntityId != null && !isGrantorEntity(inc.ownerEntityId)) continue;
      if (inc.type === "social_security") continue;
      const inflateFrom = inc.inflationStartYear ?? inc.startYear;
      const amount = inc.annualAmount * Math.pow(1 + inc.growthRate, year - inflateFrom);
      const tt = inc.taxType ?? legacyTaxType(inc.type);
      switch (tt) {
        case "earned_income": taxDetail.earnedIncome += amount; break;
        case "ordinary_income": taxDetail.ordinaryIncome += amount; break;
        case "dividends": taxDetail.dividends += amount; break;
        case "capital_gains": taxDetail.capitalGains += amount; break;
        case "stcg": taxDetail.stCapitalGains += amount; break;
        case "qbi": taxDetail.qbi += amount; break;
        case "tax_exempt": taxDetail.taxExempt += amount; break;
      }
      taxDetail.bySource[inc.id] = { type: tt, amount };
    }
    // Add RMDs to ordinary income
    if (householdRmdIncome > 0) {
      taxDetail.ordinaryIncome += householdRmdIncome;
    }
    if (grantorRmdTaxable > 0) {
      taxDetail.ordinaryIncome += grantorRmdTaxable;
    }

    // Add transfer and sale income to tax detail
    taxDetail.ordinaryIncome += transferResult.taxableOrdinaryIncome;
    taxDetail.capitalGains += transferResult.capitalGains + saleResult.capitalGains;

    // Track sources for drill-down
    for (const [tid, info] of Object.entries(transferResult.byTransfer)) {
      if (info.amount > 0) {
        taxDetail.bySource[`transfer:${tid}`] = { type: "ordinary_income", amount: info.amount };
      }
    }
    for (const item of saleResult.breakdown) {
      if (item.capitalGain > 0) {
        taxDetail.bySource[`sale:${item.transactionId}`] = { type: "capital_gains", amount: item.capitalGain };
      }
    }

    // 5. Taxes on household + grantor-trust income/RMDs. Routes to bracket or flat
    // engine depending on planSettings.taxEngineMode and whether tax year data is loaded.
    const resolved = taxResolver ? taxResolver.getYear(year) : null;
    const filingStatus = effectiveFilingStatus(
      (client.filingStatus ?? "single") as FilingStatus,
      firstDeathYear,
      year,
    );
    const useBracket = planSettings.taxEngineMode === "bracket" && resolved != null;

    // Pre-compute salary-by-owner and salary-by-rule-id so both the deduction
    // derivation and the employer-match + percent-mode employee contribution
    // paths resolve against the same per-owner salary. Filters to personal
    // (non-entity) salary income within the year range.
    const salaryByOwner: Record<"client" | "spouse" | "joint", number> = {
      client: 0,
      spouse: 0,
      joint: 0,
    };
    for (const inc of currentIncomes) {
      if (inc.type !== "salary") continue;
      if (inc.ownerEntityId != null) continue;
      if (year < inc.startYear || year > inc.endYear) continue;
      const inflateFrom = inc.inflationStartYear ?? inc.startYear;
      const amount = inc.annualAmount * Math.pow(1 + inc.growthRate, year - inflateFrom);
      salaryByOwner[inc.owner] += amount;
    }
    const totalHouseholdSalary =
      salaryByOwner.client + salaryByOwner.spouse + salaryByOwner.joint;
    const accountById = new Map(data.accounts.map((a) => [a.id, a]));
    const salaryByRuleId: Record<string, number> = {};
    for (const rule of data.savingsRules) {
      const acct = accountById.get(rule.accountId);
      salaryByRuleId[rule.id] =
        acct && (acct.owner === "client" || acct.owner === "spouse")
          ? salaryByOwner[acct.owner]
          : totalHouseholdSalary;
    }

    // Resolve each rule's pre-cap dollar contribution so we can apply IRS
    // contribution limits in one place. Respects scheduleOverrides first,
    // then contributeMax (IRS limit), then percent-mode vs annualAmount.
    // Rules outside their year range are left out entirely (keys absent).
    const resolvedByRuleId: Record<string, number> = {};
    for (const rule of data.savingsRules) {
      if (year < rule.startYear || year > rule.endYear) continue;
      const override = rule.scheduleOverrides?.get(year);
      if (override != null) {
        resolvedByRuleId[rule.id] = override;
        continue;
      }
      if (rule.contributeMax && resolved) {
        const acct = accountById.get(rule.accountId);
        if (acct) {
          const ownerDob =
            acct.owner === "spouse" ? client.spouseDob : client.dateOfBirth;
          const age = resolveAgeInYear(ownerDob, year);
          resolvedByRuleId[rule.id] = computeMaxContribution(
            acct.subType ?? "",
            resolved.params,
            age
          );
          continue;
        }
      }
      const salary = salaryByRuleId[rule.id] ?? 0;
      resolvedByRuleId[rule.id] = resolveContributionAmount(rule, salary);
    }

    // Apply IRS 401k/403b and IRA contribution limits (aggregated per owner).
    // Rules with applyContributionLimit === false bypass the cap.
    const capResult = resolved
      ? applyContributionLimits({
          year,
          rules: data.savingsRules,
          accounts: data.accounts,
          client,
          taxYearParams: resolved.params,
          resolvedByRuleId,
        })
      : { cappedByRuleId: resolvedByRuleId, adjustments: [] };
    const cappedByRuleId = capResult.cappedByRuleId;

    let aboveLineDeductions = 0;
    let itemizedDeductions = 0;
    let deductionBreakdownResult: DeductionBreakdown | undefined;
    if (useBracket) {
      const contributions = [
        deriveAboveLineFromSavings(
          year,
          data.savingsRules.map((r) => ({
            id: r.id,
            accountId: r.accountId,
            annualAmount: r.annualAmount,
            annualPercent: r.annualPercent ?? null,
            isDeductible: r.isDeductible,
            startYear: r.startYear,
            endYear: r.endYear,
          })),
          data.accounts.map((a) => ({
            id: a.id,
            subType: a.subType ?? "",
            category: a.category,
            ownerEntityId: a.ownerEntityId,
          })),
          isGrantorEntity,
          salaryByRuleId,
          cappedByRuleId
        ),
        deriveAboveLineFromExpenses(year, allExpenses.map((e) => ({
          deductionType: e.deductionType ?? null,
          annualAmount: e.annualAmount,
          startYear: e.startYear,
          endYear: e.endYear,
          growthRate: e.growthRate,
          inflationStartYear: e.inflationStartYear,
        }))),
        deriveItemizedFromExpenses(year, allExpenses.map((e) => ({
          deductionType: e.deductionType ?? null,
          annualAmount: e.annualAmount,
          startYear: e.startYear,
          endYear: e.endYear,
          growthRate: e.growthRate,
          inflationStartYear: e.inflationStartYear,
        }))),
        deriveMortgageInterestFromLiabilities(
          year,
          currentLiabilities.map((l) => ({
            id: l.id,
            isInterestDeductible: l.isInterestDeductible ?? false,
            startYear: l.startYear,
            endYear: l.startYear + Math.ceil(l.termMonths / 12) - 1,
          })),
          liabResult.interestByLiability
        ),
        derivePropertyTaxFromAccounts(
          year,
          workingAccounts.map((a) => ({
            id: a.id,
            name: a.name,
            category: a.category,
            annualPropertyTax: a.annualPropertyTax ?? 0,
            propertyTaxGrowthRate: a.propertyTaxGrowthRate ?? 0.03,
          })),
          planSettings.planStartYear
        ),
        sumItemizedFromEntries(year, data.deductions ?? []),
      ];
      // Estimate state income tax for SALT pool before aggregation.
      const preAGI = Math.max(0, taxableIncome - contributions[0].aboveLine - contributions[1].aboveLine - contributions[5].aboveLine);
      const estStateTax = preAGI * planSettings.flatStateRate;
      const stateIncomeTaxContribution: import("../lib/tax/derive-deductions").DeductionContribution = {
        aboveLine: 0,
        itemized: 0,
        saltPool: estStateTax,
      };
      const agg = aggregateDeductions(year, ...contributions, stateIncomeTaxContribution);
      aboveLineDeductions = agg.aboveLine;
      itemizedDeductions = agg.itemized;

      // Assemble per-source breakdown for drill-down UI.
      const retirementContributions = contributions[0].aboveLine;
      const expenseAboveLine = contributions[1].aboveLine;
      const manualAboveLine = contributions[5].aboveLine;

      // Below-line per-category split from source data
      let charitable = 0;
      let otherItemized = 0;
      const belowLineBySource: Record<string, { label: string; amount: number }> = {};

      for (const exp of allExpenses) {
        if (!exp.deductionType || exp.deductionType === "above_line" || exp.deductionType === "property_tax") continue;
        if (year < exp.startYear || year > exp.endYear) continue;
        const inflateFrom = exp.inflationStartYear ?? exp.startYear;
        const amount = exp.annualAmount * Math.pow(1 + exp.growthRate, year - inflateFrom);
        if (exp.deductionType === "charitable") {
          charitable += amount;
          belowLineBySource[exp.id] = { label: `Expense: ${exp.name}`, amount };
        } else {
          otherItemized += amount;
          belowLineBySource[exp.id] = { label: `Expense: ${exp.name}`, amount };
        }
      }

      for (const row of data.deductions ?? []) {
        if (year < row.startYear || year > row.endYear) continue;
        const yearsSinceStart = year - row.startYear;
        const inflated = row.annualAmount * Math.pow(1 + row.growthRate, yearsSinceStart);
        if (row.type === "charitable") {
          charitable += inflated;
        } else if (row.type === "below_line") {
          otherItemized += inflated;
        }
      }

      const interestPaid = contributions[3].itemized;
      const rawPropertyTax = contributions[2].saltPool + contributions[4].saltPool + contributions[5].saltPool;
      // estStateTax already computed above for aggregateDeductions
      const rawSalt = rawPropertyTax + estStateTax;
      const taxesPaid = Math.min(rawSalt, saltCap(year));
      const itemizedTotal = charitable + taxesPaid + interestPaid + otherItemized;

      const aboveLineBySource: Record<string, { label: string; amount: number }> = {};
      for (const rule of data.savingsRules) {
        if (year < rule.startYear || year > rule.endYear) continue;
        const acct = data.accounts.find((a) => a.id === rule.accountId);
        if (!acct) continue;
        const subType = acct.subType ?? "";
        if (subType !== "traditional_ira" && subType !== "401k") continue;
        if (acct.ownerEntityId != null && !isGrantorEntity(acct.ownerEntityId)) continue;
        aboveLineBySource[rule.id] = { label: acct.name, amount: rule.annualAmount };
      }

      const stdDed = resolved!.params.stdDeduction[filingStatus];
      deductionBreakdownResult = {
        aboveLine: {
          retirementContributions,
          taggedExpenses: expenseAboveLine,
          manualEntries: manualAboveLine,
          total: aboveLineDeductions,
          bySource: aboveLineBySource,
        },
        belowLine: {
          charitable,
          taxesPaid,
          stateIncomeTax: estStateTax,
          propertyTaxes: rawPropertyTax,
          interestPaid,
          otherItemized,
          itemizedTotal,
          standardDeduction: stdDed,
          taxDeductions: Math.max(itemizedTotal, stdDed),
          bySource: belowLineBySource,
        },
      };
    }

    // Sum self-employment earnings for SECA. Applies each income's own
    // growth/schedule treatment (same way computeIncome does), so the SE
    // number lines up with what the advisor sees as household business
    // income. Only personal (non-entity) SE flows are taxed at the
    // household level here.
    let seEarnings = 0;
    for (const inc of currentIncomes) {
      if (!inc.isSelfEmployment) continue;
      if (year < inc.startYear || year > inc.endYear) continue;
      if (inc.ownerEntityId != null && !isGrantorEntity(inc.ownerEntityId)) continue;
      let amount: number;
      if (inc.scheduleOverrides) {
        amount = inc.scheduleOverrides.get(year) ?? 0;
      } else {
        const inflateFrom = inc.inflationStartYear ?? inc.startYear;
        amount = inc.annualAmount * Math.pow(1 + inc.growthRate, year - inflateFrom);
      }
      seEarnings += amount;
    }
    const secaResult = useBracket && resolved
      ? calcSeca({
          seEarnings,
          ssTaxRate: resolved.params.ssTaxRate,
          ssWageBase: resolved.params.ssWageBase,
          medicareTaxRate: resolved.params.medicareTaxRate,
          ficaSsWages: taxDetail.earnedIncome,
        })
      : { seTax: 0, deductibleHalf: 0 };
    // Deductible-half-of-SE-tax is an above-the-line adjustment per §164(f).
    const aboveLineWithSeca = aboveLineDeductions + secaResult.deductibleHalf;

    // Split realization OI out of the generic ordinaryIncome bucket so NIIT
    // (IRC §1411) can see investment interest while still excluding RMDs,
    // IRA distributions, and SE earnings which ride in ordinaryIncome.
    const interestIncomeForTax = realizationOI;
    const taxResult = useBracket
      ? calculateTaxYearBracket({
          year,
          filingStatus,
          earnedIncome: taxDetail.earnedIncome,
          ordinaryIncome: Math.max(0, taxDetail.ordinaryIncome - interestIncomeForTax),
          interestIncome: interestIncomeForTax,
          qualifiedDividends: taxDetail.dividends,
          longTermCapitalGains: taxDetail.capitalGains,
          shortTermCapitalGains: taxDetail.stCapitalGains,
          qbiIncome: taxDetail.qbi,
          taxExemptIncome: taxDetail.taxExempt,
          socialSecurityGross: income.socialSecurity,
          aboveLineDeductions: aboveLineWithSeca,
          itemizedDeductions,
          flatStateRate: planSettings.flatStateRate,
          taxParams: resolved!.params,
          inflationFactor: resolved!.inflationFactor,
        })
      : calculateTaxYearFlat({
          taxableIncome,
          flatFederalRate: planSettings.flatFederalRate,
          flatStateRate: planSettings.flatStateRate,
          taxParams: resolved?.params ?? makeEmptyTaxParams(year),
          // Flat mode doesn't model SS taxability, so SS (and anything else
          // not rolled into `taxableIncome` above) surfaces as non-taxable so
          // the UI's "Non-Taxable" / "Gross Total Income" columns reflect the
          // advisor's actual cash picture instead of reading as stub zeros.
          nonTaxableIncome: Math.max(0, income.total - taxableIncome),
        });

    // Early withdrawal penalty from transfers
    if (transferResult.earlyWithdrawalPenalty > 0) {
      taxResult.flow.totalTax += transferResult.earlyWithdrawalPenalty;
      taxResult.flow.totalFederalTax += transferResult.earlyWithdrawalPenalty;
    }

    // SECA tax rolls up into both totals — it's federal payroll tax.
    if (secaResult.seTax > 0) {
      taxResult.flow.totalTax += secaResult.seTax;
      taxResult.flow.totalFederalTax += secaResult.seTax;
    }

    const taxes = taxResult.flow.totalTax;

    // Marginal rate for withdrawal gross-up. In bracket mode, use the true marginal
    // federal rate from the tax result so high-income clients aren't systematically
    // under-grossed. Fall back to the flat rate when bracket engine is not active.
    const marginalFedRate = useBracket
      ? taxResult.diag.marginalFederalRate
      : planSettings.flatFederalRate;
    const marginalRate = Math.min(
      0.99,
      marginalFedRate + planSettings.flatStateRate
    );

    // 6. Route each income to its cash account (override or default for owner).
    // Prefer the per-source amount already resolved by `computeIncome` — that
    // handles pia_at_fra (orchestrator), schedule overrides, spousal / survivor
    // logic, and the no_benefit / deceased-spouse suppressions. Falling back
    // to `annualAmount × growth^N` here would re-derive SS with legacy rules
    // and credit a different number than `income.socialSecurity` shows (and
    // than `socialSecurityGross` fed into the tax calc), producing three
    // different SS numbers per row.
    for (const inc of currentIncomes) {
      if (year < inc.startYear || year > inc.endYear) continue;
      const resolved = income.bySource[inc.id] ?? grantorIncome.bySource[inc.id];
      let amount: number;
      if (resolved != null) {
        amount = resolved;
      } else {
        // Non-grantor entity incomes (and anything else computeIncome filtered
        // out): apply the same claimingAge gate and legacy growth compounding
        // the previous implementation used.
        if (inc.type === "social_security" && inc.claimingAge != null) {
          const ownerDob = inc.owner === "spouse" ? client.spouseDob : client.dateOfBirth;
          if (!ownerDob) continue;
          const birthYear = parseInt(ownerDob.slice(0, 4), 10);
          if (year < birthYear + inc.claimingAge) continue;
        }
        const inflateFrom = inc.inflationStartYear ?? inc.startYear;
        amount = inc.annualAmount * Math.pow(1 + inc.growthRate, year - inflateFrom);
      }
      creditCash(resolveCashAccount(inc.ownerEntityId, inc.cashAccountId), amount, {
        category: "income",
        label: `Income: ${inc.name}`,
        sourceId: inc.id,
      });
    }

    // 7. Route each expense as an outflow from its cash account.
    for (const exp of allExpenses) {
      if (year < exp.startYear || year > exp.endYear) continue;
      const inflateFrom = exp.inflationStartYear ?? exp.startYear;
      const amount = exp.annualAmount * Math.pow(1 + exp.growthRate, year - inflateFrom);
      creditCash(resolveCashAccount(exp.ownerEntityId, exp.cashAccountId), -amount, {
        category: "expense",
        label: `Expense: ${exp.name}`,
        sourceId: exp.id,
      });
    }

    // 8. Liability payments settle against the owning party's cash account.
    for (const liab of data.liabilities) {
      const payment = liabResult.byLiability[liab.id] ?? 0;
      if (payment === 0) continue;
      creditCash(resolveCashAccount(liab.ownerEntityId), -payment, {
        category: "liability",
        label: `Liability: ${liab.name}`,
        sourceId: liab.id,
      });
    }

    // 9. Taxes are paid from household checking.
    creditCash(defaultChecking?.id, -taxes, {
      category: "tax",
      label: "Federal + state taxes",
    });

    // 10. Savings contributions — with a default checking account, savings apply at the
    // full rule amount (cash leaves checking). Without one, fall back to the legacy
    // surplus cap so behaviour matches the pre-migration engine.
    const householdInflows = income.total + householdRmdIncome;
    const householdNonSavingsOutflows =
      expenseBreakdown.living +
      expenseBreakdown.other +
      expenseBreakdown.insurance +
      liabResult.totalPayment +
      taxes;
    const surplusBeforeSavings = householdInflows - householdNonSavingsOutflows;

    const savings = hasChecking
      ? applySavingsRules(
          data.savingsRules,
          year,
          income.salaries,
          undefined,
          salaryByRuleId,
          cappedByRuleId
        )
      : applySavingsRules(
          data.savingsRules,
          year,
          income.salaries,
          Math.max(0, surplusBeforeSavings),
          salaryByRuleId,
          cappedByRuleId
        );

    // Credit employee contributions to destination accounts and debit household checking.
    for (const [acctId, amount] of Object.entries(savings.byAccount)) {
      if (amount === 0) continue;
      accountBalances[acctId] = (accountBalances[acctId] ?? 0) + amount;
      if (accountLedgers[acctId]) {
        accountLedgers[acctId].contributions += amount;
        accountLedgers[acctId].endingValue += amount;
        const destName = data.accounts.find((a) => a.id === acctId)?.name ?? "account";
        accountLedgers[acctId].entries.push({
          category: "savings_contribution",
          label: `Contribution to ${destName}`,
          amount,
          sourceId: acctId,
        });
      }
    }
    creditCash(defaultChecking?.id, -savings.total, {
      category: "savings_contribution",
      label: "Savings contributions",
    });

    // Employer match — direct credit to the destination account, free cash from the
    // employer. Does not touch household checking. Unlike employee contributions,
    // the match must be computed against *only* the account owner's salary — a
    // spouse's salary can't ground the other spouse's 401k match. Joint-owned or
    // orphaned-rule accounts get no match (no individual salary to base it on).
    for (const rule of data.savingsRules) {
      if (year < rule.startYear || year > rule.endYear) continue;
      const acct = data.accounts.find((a) => a.id === rule.accountId);
      const ownerSalary =
        acct && (acct.owner === "client" || acct.owner === "spouse")
          ? salaryByOwner[acct.owner]
          : 0;
      const match = computeEmployerMatch(rule, ownerSalary);
      if (match === 0) continue;
      accountBalances[rule.accountId] = (accountBalances[rule.accountId] ?? 0) + match;
      if (accountLedgers[rule.accountId]) {
        accountLedgers[rule.accountId].contributions += match;
        accountLedgers[rule.accountId].endingValue += match;
        let label: string;
        if (rule.employerMatchAmount != null && rule.employerMatchAmount > 0) {
          label = "Employer match (flat annual)";
        } else if (rule.employerMatchCap != null) {
          label = `Employer match (${(rule.employerMatchPct! * 100).toFixed(0)}% on ${(rule.employerMatchCap * 100).toFixed(1)}% of salary)`;
        } else {
          label = `Employer match (${(rule.employerMatchPct! * 100).toFixed(2)}% of salary)`;
        }
        accountLedgers[rule.accountId].entries.push({
          category: "employer_match",
          label,
          amount: match,
        });
      }
    }

    // Snapshot the checking balance *before* this year's inflows/outflows are applied
    // so we can attribute any drawdown of prior-year cash surplus as a "withdrawal
    // from cash" in the withdrawals drill-down.
    const checkingBalanceBeforeDeltas = hasChecking
      ? accountBalances[defaultChecking!.id] ?? 0
      : 0;

    // 11. Apply the accumulated cash deltas to balances and ledgers. Itemized entries
    // collected during creditCash are flushed onto the ledger in the order they were
    // recorded so the modal can show a per-year transaction list.
    for (const [acctId, delta] of Object.entries(cashDelta)) {
      accountBalances[acctId] = (accountBalances[acctId] ?? 0) + delta;
      if (accountLedgers[acctId]) {
        if (delta >= 0) {
          accountLedgers[acctId].contributions += delta;
          accountLedgers[acctId].endingValue += delta;
        } else {
          accountLedgers[acctId].distributions += -delta;
          accountLedgers[acctId].endingValue += delta;
        }
        const entries = pendingEntries[acctId];
        if (entries) accountLedgers[acctId].entries.push(...entries);
      }
    }

    // 12. Withdrawals + gap-fill. Household checking should never end the year
    // negative: any deficit after income/expenses/taxes/savings (and the BoY
    // purchase equity) is refilled from the withdrawal strategy (grossed up
    // for tax).
    let withdrawals = { byAccount: {} as Record<string, number>, total: 0 };
    let withdrawalTax = 0;

    // 12a. Cash drawdown reporting — when this year's net flow ate into a
    // prior-year surplus sitting in household checking, attribute the consumed
    // portion as a withdrawal from cash. Reporting-only; balance movement was
    // already captured by the individual entries.
    if (hasChecking) {
      const checkingId = defaultChecking!.id;
      const endingAfterDeltas = accountBalances[checkingId] ?? 0;
      const consumed = checkingBalanceBeforeDeltas - endingAfterDeltas;
      const cashDrawdown = Math.max(
        0,
        Math.min(Math.max(0, checkingBalanceBeforeDeltas), consumed)
      );
      if (cashDrawdown > 0) {
        withdrawals.byAccount[checkingId] = cashDrawdown;
        withdrawals.total += cashDrawdown;
      }
    }

    // 12b. Build withdrawal source balances reflecting post-BoY-purchase state
    // so gap-fill doesn't pull from an account that was just drained to fund a
    // purchase.
    const householdWithdrawBalances: Record<string, number> = {};
    for (const acct of workingAccounts) {
      if (acct.ownerEntityId != null) continue;
      if (acct.isDefaultChecking) continue;
      householdWithdrawBalances[acct.id] = acct.id in accountBalances ? accountBalances[acct.id] : 0;
    }

    if (hasChecking) {
      const checkingId = defaultChecking!.id;

      // If checking went negative (from P&L and/or a purchase), pull from the
      // withdrawal strategy to refill. Gross up by the marginal rate so the
      // post-tax amount covers the gap; the extra tax is added to the year's
      // tax expense.
      if (accountBalances[checkingId] < 0) {
        const shortfall = -accountBalances[checkingId];
        const grossNeeded = shortfall / (1 - marginalRate);
        const supplemental = executeWithdrawals(
          grossNeeded,
          effectiveWithdrawalStrategy,
          householdWithdrawBalances,
          year
        );

        for (const [acctId, amount] of Object.entries(supplemental.byAccount)) {
          accountBalances[acctId] -= amount;
          withdrawals.byAccount[acctId] = (withdrawals.byAccount[acctId] ?? 0) + amount;
          withdrawals.total += amount;
          if (accountLedgers[acctId]) {
            accountLedgers[acctId].distributions += amount;
            accountLedgers[acctId].endingValue -= amount;
            accountLedgers[acctId].entries.push({
              category: "withdrawal",
              label: "Withdrawal to cover household shortfall",
              amount: -amount,
            });
          }
        }

        // Gross supplemental withdrawal lands in checking.
        accountBalances[checkingId] += supplemental.total;
        if (accountLedgers[checkingId]) {
          accountLedgers[checkingId].contributions += supplemental.total;
          accountLedgers[checkingId].endingValue += supplemental.total;
          accountLedgers[checkingId].entries.push({
            category: "withdrawal",
            label: "Withdrawal to cover shortfall",
            amount: supplemental.total,
          });
        }

        // Marginal tax on the gross supplemental withdrawal comes back out of
        // checking and is reported as additional taxes for the year.
        withdrawalTax = supplemental.total * marginalRate;
        accountBalances[checkingId] -= withdrawalTax;
        if (accountLedgers[checkingId]) {
          accountLedgers[checkingId].distributions += withdrawalTax;
          accountLedgers[checkingId].endingValue -= withdrawalTax;
          accountLedgers[checkingId].entries.push({
            category: "withdrawal_tax",
            label: `Tax on withdrawal (${(marginalRate * 100).toFixed(1)}%)`,
            amount: -withdrawalTax,
          });
        }
      }
    } else {
      // Legacy path: no default checking → deficit triggers withdrawal directly
      // (no gross-up because the legacy path doesn't model the withdrawal tax
      // separately). Purchase equity is folded into outflows so a purchase-driven
      // deficit still triggers a withdrawal.
      const purchaseEquity = purchaseBreakdown.reduce((sum, p) => sum + p.equity, 0);
      const legacyNetFlow = householdInflows - householdNonSavingsOutflows - savings.total - purchaseEquity;
      if (legacyNetFlow < 0) {
        withdrawals = executeWithdrawals(
          -legacyNetFlow,
          effectiveWithdrawalStrategy,
          householdWithdrawBalances,
          year
        );
        for (const [acctId, amount] of Object.entries(withdrawals.byAccount)) {
          accountBalances[acctId] -= amount;
          if (accountLedgers[acctId]) {
            accountLedgers[acctId].distributions += amount;
            accountLedgers[acctId].endingValue -= amount;
            accountLedgers[acctId].entries.push({
              category: "withdrawal",
              label: "Withdrawal to cover shortfall",
              amount: -amount,
            });
          }
        }
      }
    }

    // 13. Portfolio snapshot. An account is included if it has no entity owner or if
    // its entity is flagged to roll into portfolio assets.
    const portfolioAssets = {
      taxable: {} as Record<string, number>,
      cash: {} as Record<string, number>,
      retirement: {} as Record<string, number>,
      realEstate: {} as Record<string, number>,
      business: {} as Record<string, number>,
      lifeInsurance: {} as Record<string, number>,
      taxableTotal: 0,
      cashTotal: 0,
      retirementTotal: 0,
      realEstateTotal: 0,
      businessTotal: 0,
      lifeInsuranceTotal: 0,
      total: 0,
    };
    const categoryToKey: Record<string, "taxable" | "cash" | "retirement" | "realEstate" | "business" | "lifeInsurance"> = {
      taxable: "taxable",
      cash: "cash",
      retirement: "retirement",
      real_estate: "realEstate",
      business: "business",
      life_insurance: "lifeInsurance",
    };
    for (const acct of workingAccounts) {
      if (acct.ownerEntityId != null) {
        const entity = entityMap[acct.ownerEntityId];
        if (!entity?.includeInPortfolio) continue;
      }
      const val = accountBalances[acct.id] ?? 0;
      const key = categoryToKey[acct.category] ?? "taxable";
      portfolioAssets[key][acct.id] = val;
      const totalKey = `${key}Total` as keyof typeof portfolioAssets;
      (portfolioAssets[totalKey] as number) += val;
    }
    portfolioAssets.total =
      portfolioAssets.taxableTotal +
      portfolioAssets.cashTotal +
      portfolioAssets.retirementTotal +
      portfolioAssets.realEstateTotal +
      portfolioAssets.businessTotal +
      portfolioAssets.lifeInsuranceTotal;

    // 14. Assemble the year. P&L-style totals:
    //   Total Income   = earned income + household RMDs  (no withdrawals — those are
    //                    a balancing mechanism below the P&L)
    //   Total Expenses = base expenses + savings + taxes  (taxes includes both the
    //                    income/RMD tax and the gross-up tax on any supplemental
    //                    withdrawal the engine made to refill household cash)
    //   Net Cash Flow  = Total Income - Total Expenses   (can be negative)
    // When Net Cash Flow is negative, |Net Cash Flow| equals the gross withdrawal the
    // engine actually pulled from the strategy, so the two reconcile — household cash
    // drops by |Net Cash Flow| and the withdrawal refills it by the same amount.
    // ── Technique income and expenses ──────────────────────────────────────
    // Sale proceeds (net of transaction costs and mortgage payoff) are "other"
    // income.  Transaction costs from sales and equity outflows from purchases
    // are "other" expenses.  These show up in the cash-flow drill-down so
    // advisors can see the P&L impact of techniques.
    let techniqueIncome = 0;
    const techniqueIncomeBySource: Record<string, number> = {};
    let techniqueExpenses = 0;
    const techniqueExpenseBySource: Record<string, number> = {};

    // Year-level netting: when sales and purchases coexist in the same year,
    // absorb same-year purchase equity against same-year sale netProceeds
    // before surfacing either side in the cash flow. This matches advisor
    // intuition for a "swap" (sell one property, buy another) — the headline
    // cash impact is the NET of both legs, not the raw sale proceeds with the
    // purchase equity shown in a separate column.
    //
    // Distribution rules:
    //   totalAbsorption = min(Σ sale.netProceeds, Σ purchase.equity)
    //   Each sale's surfaced income = sale.netProceeds - (sale.netProceeds / Σ netProceeds) × totalAbsorption
    //   Each purchase's surfaced expense = purchase.equity - (purchase.equity / Σ equity) × totalAbsorption
    // After distribution, sum of income bySource entries = max(0, yearNet);
    // sum of purchase bySource entries = max(0, -yearNet).
    //
    // Transaction costs are NOT a separate expense line — they're already
    // deducted from netProceeds (in applyAssetSales) and surface in the sale
    // drill-down breakdown.
    const totalNetProceeds = saleResult.breakdown.reduce((s, x) => s + x.netProceeds, 0);
    const totalPurchaseEquity = purchaseBreakdown.reduce((s, x) => s + x.equity, 0);
    const absorption = Math.min(totalNetProceeds, totalPurchaseEquity);

    for (const item of saleResult.breakdown) {
      const saleShare = totalNetProceeds > 0 ? item.netProceeds / totalNetProceeds : 0;
      const netImpact = item.netProceeds - absorption * saleShare;

      if (netImpact > 0) {
        techniqueIncome += netImpact;
        techniqueIncomeBySource[`technique-proceeds:${item.transactionId}`] = netImpact;
      }
    }

    for (const item of purchaseBreakdown) {
      if (item.equity <= 0) continue;
      const purchaseShare = totalPurchaseEquity > 0 ? item.equity / totalPurchaseEquity : 0;
      const uncoveredEquity = item.equity - absorption * purchaseShare;

      if (uncoveredEquity > 0) {
        techniqueExpenses += uncoveredEquity;
        techniqueExpenseBySource[`technique-purchase:${item.transactionId}`] = uncoveredEquity;
      }
    }

    // Fold technique amounts into income
    income.other += techniqueIncome;
    income.total += techniqueIncome;
    Object.assign(income.bySource, techniqueIncomeBySource);

    const totalTaxes = taxes + withdrawalTax;
    const expenses = {
      living: expenseBreakdown.living,
      liabilities: liabResult.totalPayment,
      other: expenseBreakdown.other + techniqueExpenses,
      insurance: expenseBreakdown.insurance,
      realEstate: syntheticExpenses.reduce((sum, s) => sum + s.annualAmount, 0),
      taxes: totalTaxes,
      total:
        expenseBreakdown.living +
        expenseBreakdown.other +
        expenseBreakdown.insurance +
        syntheticExpenses.reduce((sum, s) => sum + s.annualAmount, 0) +
        liabResult.totalPayment +
        totalTaxes +
        techniqueExpenses,
      bySource: {
        ...expenseBreakdown.bySource,
        ...Object.fromEntries(syntheticExpenses.map((s) => [s.id, s.annualAmount])),
        ...techniqueExpenseBySource,
      },
      byLiability: liabResult.byLiability,
      interestByLiability: liabResult.interestByLiability,
    };

    const totalIncome = income.total + householdRmdIncome;
    const totalExpenses = expenses.total + savings.total;
    const netCashFlow = totalIncome - totalExpenses;

    // Build technique breakdown for drill-down UI
    const hasTechniques = saleResult.breakdown.length > 0 || purchaseBreakdown.length > 0;
    const txnNameMap = new Map((data.assetTransactions ?? []).map((t) => [t.id, t.name]));

    // 4d-2: hypothetical estate tax — computed on the pre-real-death snapshot
    // of year-N state, so the report always displays consistent "both die in
    // year N" numbers regardless of where real deaths land. Attached to the
    // ProjectionYear at push time so the required field is always populated.
    const clientFilingStatus = (client.filingStatus ?? "single") as FilingStatus;
    const hypotheticalIsMarried =
      clientFilingStatus === "married_joint" ||
      clientFilingStatus === "married_separate";
    const hypotheticalEstateTax = computeHypotheticalEstateTax({
      year,
      isMarried: hypotheticalIsMarried,
      accounts: workingAccounts,
      accountBalances,
      basisMap,
      incomes: currentIncomes,
      liabilities: currentLiabilities,
      familyMembers: data.familyMembers ?? [],
      externalBeneficiaries: data.externalBeneficiaries ?? [],
      entities: data.entities ?? [],
      wills: data.wills ?? [],
      planSettings,
      gifts: data.gifts ?? [],
      annualExclusionsByYear,
    });

    years.push({
      year,
      ages,
      income,
      ...(income.socialSecurityDetail ? { socialSecurityDetail: income.socialSecurityDetail } : {}),
      taxDetail,
      taxResult,
      deductionBreakdown: deductionBreakdownResult,
      withdrawals,
      expenses,
      savings,
      totalIncome,
      totalExpenses,
      netCashFlow,
      portfolioAssets,
      accountLedgers,
      accountBasisBoY,
      liabilityBalancesBoY,
      hypotheticalEstateTax,
      ...(hasTechniques
        ? {
            techniqueBreakdown: {
              sales: saleResult.breakdown.map((s) => ({
                transactionId: s.transactionId,
                name: txnNameMap.get(s.transactionId) ?? s.transactionId,
                saleValue: s.saleValue,
                transactionCosts: s.transactionCosts,
                mortgagePaidOff: s.mortgagePaidOff,
                netProceeds: s.netProceeds,
                capitalGain: s.capitalGain,
              })),
              purchases: purchaseBreakdown.map((p) => ({
                transactionId: p.transactionId,
                name: p.name,
                purchasePrice: p.purchasePrice,
                mortgageAmount: p.mortgageAmount,
                equity: p.equity,
                liabilityId: p.liabilityId,
                liabilityName: p.liabilityName,
              })),
            },
          }
        : {}),
    });

    // Death event (spec 4b) — fires exactly once at the first death year.
    if (
      firstDeathYear != null &&
      firstDeathDeceased != null &&
      firstDeathSurvivor != null &&
      year === firstDeathYear
    ) {
      const deceasedWill = (data.wills ?? []).find(
        (w) => w.grantor === firstDeathDeceased,
      ) ?? null;

      const deathResult = applyFirstDeath({
        year,
        deceased: firstDeathDeceased,
        survivor: firstDeathSurvivor,
        will: deceasedWill,
        accounts: workingAccounts,
        accountBalances,
        basisMap,
        incomes: currentIncomes,
        liabilities: currentLiabilities,
        familyMembers: data.familyMembers ?? [],
        externalBeneficiaries: data.externalBeneficiaries ?? [],
        entities: data.entities ?? [],
        planSettings,
        gifts: data.gifts ?? [],
        annualExclusionsByYear,
        dsueReceived: 0, // first decedent has no prior DSUE
      });

      workingAccounts = deathResult.accounts;
      // Reassign the mutable balance / basis maps in place so later years see the new state.
      for (const key of Object.keys(accountBalances)) delete (accountBalances as Record<string, number>)[key];
      Object.assign(accountBalances, deathResult.accountBalances);
      for (const key of Object.keys(basisMap)) delete (basisMap as Record<string, number>)[key];
      Object.assign(basisMap, deathResult.basisMap);
      currentIncomes = deathResult.incomes;
      currentLiabilities = deathResult.liabilities;

      // Stash DSUE for the final-death call (portability per §2010(c)(4)).
      stashedDSUE = deathResult.dsueGenerated;

      // Attach to the just-built ProjectionYear
      const thisYear = years[years.length - 1];
      thisYear.deathTransfers = deathResult.transfers;
      thisYear.deathWarnings = deathResult.warnings;
      thisYear.estateTax = deathResult.estateTax;
    }

    // Final-death event (spec 4c) — fires at the final death year. For
    // same-year double death, fires the same year as 4b on the already-4b-
    // mutated state. After this block, break out of the year loop to
    // truncate the projection.
    if (
      finalDeathYear != null &&
      finalDeceased != null &&
      year === finalDeathYear
    ) {
      const finalWill = (data.wills ?? []).find(
        (w) => w.grantor === finalDeceased,
      ) ?? null;

      const finalResult = applyFinalDeath({
        year,
        deceased: finalDeceased,
        // survivor field is unused by applyFinalDeath internally; pass
        // deceased as a safe placeholder to keep the shared input type.
        survivor: finalDeceased,
        will: finalWill,
        accounts: workingAccounts,
        accountBalances,
        basisMap,
        incomes: currentIncomes,
        liabilities: currentLiabilities,
        familyMembers: data.familyMembers ?? [],
        externalBeneficiaries: data.externalBeneficiaries ?? [],
        entities: data.entities ?? [],
        planSettings,
        gifts: data.gifts ?? [],
        annualExclusionsByYear,
        dsueReceived: stashedDSUE,
      });

      workingAccounts = finalResult.accounts;
      for (const key of Object.keys(accountBalances)) delete (accountBalances as Record<string, number>)[key];
      Object.assign(accountBalances, finalResult.accountBalances);
      for (const key of Object.keys(basisMap)) delete (basisMap as Record<string, number>)[key];
      Object.assign(basisMap, finalResult.basisMap);
      currentIncomes = finalResult.incomes;
      currentLiabilities = finalResult.liabilities;

      const thisYear = years[years.length - 1];
      thisYear.deathTransfers = [
        ...(thisYear.deathTransfers ?? []),
        ...finalResult.transfers,
      ];
      thisYear.deathWarnings = [
        ...(thisYear.deathWarnings ?? []),
        ...finalResult.warnings,
      ];
      thisYear.estateTax = finalResult.estateTax;

      break;
    }
  }

  return years;
}
