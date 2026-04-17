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
} from "./types";
import { computeIncome } from "./income";
import { computeExpenses } from "./expenses";
import { computeLiabilities } from "./liabilities";
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
import { applySavingsRules, computeEmployerMatch } from "./savings";
import { executeWithdrawals } from "./withdrawal";
import { calculateRMD } from "./rmd";
import { applyTransfers } from "./transfers";
import { applyAssetSales, applyAssetPurchases, _resetSyntheticIdCounter } from "./asset-transactions";

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

export function runProjection(data: ClientData): ProjectionYear[] {
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

  let currentLiabilities: Liability[] = data.liabilities.map((l) => ({ ...l }));

  const clientBirthYear = parseInt(client.dateOfBirth.slice(0, 4), 10);
  const spouseBirthYear = client.spouseDob
    ? parseInt(client.spouseDob.slice(0, 4), 10)
    : undefined;

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
      data.incomes,
      year,
      client,
      (inc) => inc.ownerEntityId == null
    );
    const grantorIncome = computeIncome(
      data.incomes,
      year,
      client,
      (inc) => inc.ownerEntityId != null && isGrantorEntity(inc.ownerEntityId)
    );

    // Inject synthetic property-tax expenses for real estate accounts.
    // These are not persisted — they exist only at projection time.
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

    // 2. Household expenses (entity-owned expenses are paid by the entity).
    // Pass only real expenses — synthetic property-tax expenses are tracked
    // separately in the realEstate bucket to avoid double-counting in "Other".
    const expenseBreakdown = computeExpenses(
      data.expenses,
      year,
      (exp) => exp.ownerEntityId == null
    );

    // 3. Liability payments — amortize all liabilities (so balances roll forward),
    // capture the household total for reporting, and keep the per-liability map
    // so entity liability payments can be routed to entity checking below.
    const liabResult = computeLiabilities(
      currentLiabilities,
      year,
      (liab) => liab.ownerEntityId == null
    );
    currentLiabilities = liabResult.updatedLiabilities;

    // 4. Grow every account. When the account has a realization model, split
    // growth into tax buckets: OI, QDiv, STCG, LTCG, Tax-Exempt. Turnover %
    // determines the ST/LT CG split. Taxable amounts are added to the year's
    // tax detail; basis is increased for everything except LTCG.
    const accountLedgers: Record<string, AccountLedger> = {};
    // Accumulate realization-sourced taxable income across all accounts.
    let realizationOI = 0;
    let realizationQDiv = 0;
    let realizationSTCG = 0;
    const realizationBySource: Record<string, { type: string; amount: number }> = {};

    for (const acct of workingAccounts) {
      const beginningValue = accountBalances[acct.id] ?? 0;
      const growth = beginningValue * acct.growthRate;
      const entries: AccountLedgerEntry[] = [];

      let growthDetail: AccountLedger["growthDetail"];

      if (growth !== 0 && acct.realization) {
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

        entries.push({
          category: "growth",
          label: `Growth (${(acct.growthRate * 100).toFixed(2)}%)`,
          amount: growth,
        });

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
      } else if (growth !== 0) {
        entries.push({
          category: "growth",
          label: `Growth (${(acct.growthRate * 100).toFixed(2)}%)`,
          amount: growth,
        });
      }

      accountLedgers[acct.id] = {
        beginningValue,
        growth,
        contributions: 0,
        distributions: 0,
        rmdAmount: 0,
        fees: 0,
        endingValue: beginningValue + growth,
        entries,
        growthDetail,
      };
      accountBalances[acct.id] = beginningValue + growth;
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

    // ── Apply Asset Sales ───────────────────────────────────────────────────
    let saleResult = {
      capitalGains: 0,
      removedAccountIds: [] as string[],
      removedLiabilityIds: [] as string[],
      breakdown: [] as { transactionId: string; accountId: string; saleValue: number; basis: number; transactionCosts: number; netProceeds: number; capitalGain: number; mortgagePaidOff: number; proceedsAccountId: string }[],
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
        });

        // Remove sold accounts from working list
        if (saleResult.removedAccountIds.length > 0) {
          const removed = new Set(saleResult.removedAccountIds);
          workingAccounts = workingAccounts.filter((a) => !removed.has(a.id));
        }

        // Remove paid-off mortgages
        if (saleResult.removedLiabilityIds.length > 0) {
          const removed = new Set(saleResult.removedLiabilityIds);
          currentLiabilities = currentLiabilities.filter((l) => !removed.has(l.id));
        }
      }
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
      const balance = accountBalances[acct.id] ?? 0;
      const rmd = calculateRMD(balance, ownerAge, ownerBirthYear);
      if (rmd <= 0) continue;

      accountBalances[acct.id] = balance - rmd;
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
    // Map income entries to tax categories
    for (const inc of data.incomes) {
      if (year < inc.startYear || year > inc.endYear) continue;
      if (inc.ownerEntityId != null && !isGrantorEntity(inc.ownerEntityId)) continue;
      if (inc.type === "social_security" && inc.claimingAge != null) {
        const ownerDob = inc.owner === "spouse" ? client.spouseDob : client.dateOfBirth;
        if (!ownerDob) continue;
        const birthYear = parseInt(ownerDob.slice(0, 4), 10);
        if (year < birthYear + inc.claimingAge) continue;
      }
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
    const filingStatus = (client.filingStatus ?? "single") as FilingStatus;
    const useBracket = planSettings.taxEngineMode === "bracket" && resolved != null;

    let aboveLineDeductions = 0;
    let itemizedDeductions = 0;
    let deductionBreakdownResult: DeductionBreakdown | undefined;
    if (useBracket) {
      const contributions = [
        deriveAboveLineFromSavings(
          year,
          data.savingsRules.map((r) => ({
            accountId: r.accountId,
            annualAmount: r.annualAmount,
            startYear: r.startYear,
            endYear: r.endYear,
          })),
          data.accounts.map((a) => ({
            id: a.id,
            subType: a.subType ?? "",
            ownerEntityId: a.ownerEntityId,
          })),
          isGrantorEntity
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

    const taxResult = useBracket
      ? calculateTaxYearBracket({
          year,
          filingStatus,
          earnedIncome: taxDetail.earnedIncome,
          ordinaryIncome: taxDetail.ordinaryIncome,
          qualifiedDividends: taxDetail.dividends,
          longTermCapitalGains: taxDetail.capitalGains,
          shortTermCapitalGains: taxDetail.stCapitalGains,
          qbiIncome: taxDetail.qbi,
          taxExemptIncome: taxDetail.taxExempt,
          socialSecurityGross: income.socialSecurity,
          aboveLineDeductions,
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
        });

    // Early withdrawal penalty from transfers
    if (transferResult.earlyWithdrawalPenalty > 0) {
      taxResult.flow.totalTax += transferResult.earlyWithdrawalPenalty;
      taxResult.flow.totalFederalTax += transferResult.earlyWithdrawalPenalty;
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
    for (const inc of data.incomes) {
      if (year < inc.startYear || year > inc.endYear) continue;
      if (inc.type === "social_security" && inc.claimingAge != null) {
        const ownerDob = inc.owner === "spouse" ? client.spouseDob : client.dateOfBirth;
        if (!ownerDob) continue;
        const birthYear = parseInt(ownerDob.slice(0, 4), 10);
        if (year < birthYear + inc.claimingAge) continue;
      }
      const inflateFrom = inc.inflationStartYear ?? inc.startYear;
      const amount = inc.annualAmount * Math.pow(1 + inc.growthRate, year - inflateFrom);
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
      ? applySavingsRules(data.savingsRules, year, income.salaries)
      : applySavingsRules(
          data.savingsRules,
          year,
          income.salaries,
          Math.max(0, surplusBeforeSavings)
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
    // employer. Does not touch household checking. For percentage-based matches the
    // base salary is the salary belonging to the account's owner, not total household
    // salary. For joint-owned accounts and flat-$ matches, total salary is used.
    const salaryByOwner: Record<"client" | "spouse" | "joint", number> = {
      client: 0,
      spouse: 0,
      joint: 0,
    };
    for (const inc of data.incomes) {
      if (inc.type !== "salary") continue;
      if (inc.ownerEntityId != null) continue;
      if (year < inc.startYear || year > inc.endYear) continue;
      const inflateFrom = inc.inflationStartYear ?? inc.startYear;
      const amount = inc.annualAmount * Math.pow(1 + inc.growthRate, year - inflateFrom);
      salaryByOwner[inc.owner] += amount;
    }

    for (const rule of data.savingsRules) {
      if (year < rule.startYear || year > rule.endYear) continue;
      const acct = data.accounts.find((a) => a.id === rule.accountId);
      const ownerSalary =
        acct && (acct.owner === "client" || acct.owner === "spouse")
          ? salaryByOwner[acct.owner]
          : income.salaries;
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

    // 12. If household checking went negative, cover the shortfall from the withdrawal
    // strategy — grossed up by the marginal rate so the post-tax amount covers the gap.
    // The extra tax is added to the year's tax expense.
    let withdrawals = { byAccount: {} as Record<string, number>, total: 0 };
    let withdrawalTax = 0;

    const householdWithdrawBalances: Record<string, number> = {};
    for (const acct of workingAccounts) {
      if (acct.ownerEntityId != null) continue;
      if (acct.isDefaultChecking) continue;
      householdWithdrawBalances[acct.id] = acct.id in accountBalances ? accountBalances[acct.id] : 0;
    }

    if (hasChecking) {
      const checkingId = defaultChecking!.id;

      // Cash drawdown: when this year's outflows ate into a prior-year surplus sitting
      // in household checking, attribute the consumed portion as a withdrawal from
      // cash. Reporting-only — the balance movement was already captured by the
      // individual expense/tax entries.
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

      // If checking is still negative after drawing down the surplus, fall through
      // to the supplemental withdrawal strategy to close the remaining gap.
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
      // Legacy path: no default checking → deficit triggers withdrawal directly (no
      // gross-up because the legacy path doesn't model the withdrawal tax separately).
      const legacyNetFlow = householdInflows - householdNonSavingsOutflows - savings.total;
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

    // ── Apply Asset Purchases ───────────────────────────────────────────────
    let purchaseBreakdown: { transactionId: string; name: string; equity: number; purchasePrice: number; mortgageAmount: number; fundingAccountId: string }[] = [];
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

    // For each sale, compute the net P&L impact:
    // - If paired with a purchase (same transaction), income = netProceeds - purchaseEquity
    //   (surplus goes to income; deficit goes to expense)
    // - If sale-only, income = netProceeds
    // Transaction costs are always a separate expense line.
    const purchaseByTxnId = new Map(
      purchaseBreakdown.map((p) => [p.transactionId, p])
    );

    for (const item of saleResult.breakdown) {
      if (item.transactionCosts > 0) {
        techniqueExpenses += item.transactionCosts;
        techniqueExpenseBySource[`technique-cost:${item.transactionId}`] = item.transactionCosts;
      }

      const pairedPurchase = purchaseByTxnId.get(item.transactionId);
      const purchaseEquity = pairedPurchase?.equity ?? 0;
      const netImpact = item.netProceeds - purchaseEquity;

      if (netImpact > 0) {
        // Surplus — record as income
        techniqueIncome += netImpact;
        techniqueIncomeBySource[`technique-proceeds:${item.transactionId}`] = netImpact;
      } else if (netImpact < 0) {
        // Deficit — record as expense
        techniqueExpenses += Math.abs(netImpact);
        techniqueExpenseBySource[`technique-deficit:${item.transactionId}`] = Math.abs(netImpact);
      }
    }

    // Buy-only transactions (no paired sale): purchase equity is a real expense
    for (const item of purchaseBreakdown) {
      if (item.equity > 0) {
        const hasSaleSide = saleResult.breakdown.some(
          (s) => s.transactionId === item.transactionId
        );
        if (!hasSaleSide) {
          techniqueExpenses += item.equity;
          techniqueExpenseBySource[`technique-purchase:${item.transactionId}`] = item.equity;
        }
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

    years.push({
      year,
      ages,
      income,
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
              })),
            },
          }
        : {}),
    });
  }

  return years;
}
