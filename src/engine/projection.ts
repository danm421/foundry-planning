import type {
  ClientData,
  ProjectionYear,
  AccountLedger,
  Liability,
  EntitySummary,
} from "./types";
import { computeIncome } from "./income";
import { computeExpenses } from "./expenses";
import { computeLiabilities } from "./liabilities";
import { calculateTaxes } from "./tax";
import { applySavingsRules } from "./savings";
import { executeWithdrawals } from "./withdrawal";
import { calculateRMD } from "./rmd";

export function runProjection(data: ClientData): ProjectionYear[] {
  const { client, planSettings } = data;
  const years: ProjectionYear[] = [];

  // Entity lookup for out-of-estate treatment rules.
  const entityMap: Record<string, EntitySummary> = {};
  for (const e of data.entities ?? []) entityMap[e.id] = e;

  const isGrantorEntity = (entityId: string | undefined): boolean =>
    entityId != null && entityMap[entityId]?.isGrantor === true;

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

    // 2. Household expenses (entity-owned expenses are paid by the entity).
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

    // 4. Grow every account.
    const accountLedgers: Record<string, AccountLedger> = {};
    for (const acct of data.accounts) {
      const beginningValue = accountBalances[acct.id] ?? 0;
      const growth = beginningValue * acct.growthRate;
      accountLedgers[acct.id] = {
        beginningValue,
        growth,
        contributions: 0,
        distributions: 0,
        rmdAmount: 0,
        fees: 0,
        endingValue: beginningValue + growth,
      };
      accountBalances[acct.id] = beginningValue + growth;
    }

    // Per-account cash deltas for the year. Positive = deposit, negative = withdrawal.
    const cashDelta: Record<string, number> = {};
    const creditCash = (acctId: string | undefined, amount: number) => {
      if (!acctId || amount === 0) return;
      cashDelta[acctId] = (cashDelta[acctId] ?? 0) + amount;
    };

    // 4b. RMDs. Source account balance is decremented; the cash lands in the
    // appropriate checking (household or entity) via cashDelta. Tax treatment:
    // household → household tax; grantor entity → household tax; other entity →
    // no household tax (entity handles its own, not modeled yet).
    let householdRmdIncome = 0;
    let grantorRmdTaxable = 0;
    for (const acct of data.accounts) {
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
      }

      if (acct.ownerEntityId == null) {
        householdRmdIncome += rmd;
        creditCash(defaultChecking?.id, rmd);
      } else {
        creditCash(entityCheckingByEntityId[acct.ownerEntityId], rmd);
        if (isGrantorEntity(acct.ownerEntityId)) grantorRmdTaxable += rmd;
      }
    }

    // 5. Taxes on household + grantor-trust income/RMDs.
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
      grantorRmdTaxable;
    const taxes = calculateTaxes(taxableIncome, planSettings);
    const marginalRate = Math.min(
      0.99,
      planSettings.flatFederalRate + planSettings.flatStateRate
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
      const yearsElapsed = year - inc.startYear;
      const amount = inc.annualAmount * Math.pow(1 + inc.growthRate, yearsElapsed);
      creditCash(resolveCashAccount(inc.ownerEntityId, inc.cashAccountId), amount);
    }

    // 7. Route each expense as an outflow from its cash account.
    for (const exp of data.expenses) {
      if (year < exp.startYear || year > exp.endYear) continue;
      const yearsElapsed = year - exp.startYear;
      const amount = exp.annualAmount * Math.pow(1 + exp.growthRate, yearsElapsed);
      creditCash(resolveCashAccount(exp.ownerEntityId, exp.cashAccountId), -amount);
    }

    // 8. Liability payments settle against the owning party's cash account.
    for (const liab of data.liabilities) {
      const payment = liabResult.byLiability[liab.id] ?? 0;
      if (payment === 0) continue;
      creditCash(resolveCashAccount(liab.ownerEntityId), -payment);
    }

    // 9. Taxes are paid from household checking.
    creditCash(defaultChecking?.id, -taxes);

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
      }
    }
    creditCash(defaultChecking?.id, -savings.total);

    // Employer match — direct credit to the destination account, free cash from the
    // employer. Does not touch household checking.
    if (savings.employerTotal > 0) {
      for (const rule of data.savingsRules) {
        if (year < rule.startYear || year > rule.endYear) continue;
        if (rule.employerMatchPct != null && rule.employerMatchCap != null) {
          const match = income.salaries * rule.employerMatchCap * rule.employerMatchPct;
          accountBalances[rule.accountId] = (accountBalances[rule.accountId] ?? 0) + match;
          if (accountLedgers[rule.accountId]) {
            accountLedgers[rule.accountId].contributions += match;
            accountLedgers[rule.accountId].endingValue += match;
          }
        }
      }
    }

    // 11. Apply the accumulated cash deltas to balances and ledgers.
    for (const [acctId, delta] of Object.entries(cashDelta)) {
      if (delta === 0) continue;
      accountBalances[acctId] = (accountBalances[acctId] ?? 0) + delta;
      if (accountLedgers[acctId]) {
        if (delta >= 0) {
          accountLedgers[acctId].contributions += delta;
          accountLedgers[acctId].endingValue += delta;
        } else {
          accountLedgers[acctId].distributions += -delta;
          accountLedgers[acctId].endingValue += delta;
        }
      }
    }

    // 12. If household checking went negative, cover the shortfall from the withdrawal
    // strategy — grossed up by the marginal rate so the post-tax amount covers the gap.
    // The extra tax is added to the year's tax expense.
    let withdrawals = { byAccount: {} as Record<string, number>, total: 0 };
    let withdrawalTax = 0;

    const householdWithdrawBalances: Record<string, number> = {};
    for (const acct of data.accounts) {
      if (acct.ownerEntityId != null) continue;
      if (acct.isDefaultChecking) continue;
      householdWithdrawBalances[acct.id] = accountBalances[acct.id] ?? 0;
    }

    if (hasChecking) {
      const checkingId = defaultChecking!.id;
      if (accountBalances[checkingId] < 0) {
        const shortfall = -accountBalances[checkingId];
        const grossNeeded = shortfall / (1 - marginalRate);
        withdrawals = executeWithdrawals(
          grossNeeded,
          data.withdrawalStrategy,
          householdWithdrawBalances,
          year
        );

        for (const [acctId, amount] of Object.entries(withdrawals.byAccount)) {
          accountBalances[acctId] -= amount;
          if (accountLedgers[acctId]) {
            accountLedgers[acctId].distributions += amount;
            accountLedgers[acctId].endingValue -= amount;
          }
        }

        // Gross withdrawal lands in checking.
        accountBalances[checkingId] += withdrawals.total;
        if (accountLedgers[checkingId]) {
          accountLedgers[checkingId].contributions += withdrawals.total;
          accountLedgers[checkingId].endingValue += withdrawals.total;
        }

        // Marginal tax on the gross withdrawal comes back out of checking and is
        // reported as additional taxes for the year.
        withdrawalTax = withdrawals.total * marginalRate;
        accountBalances[checkingId] -= withdrawalTax;
        if (accountLedgers[checkingId]) {
          accountLedgers[checkingId].distributions += withdrawalTax;
          accountLedgers[checkingId].endingValue -= withdrawalTax;
        }
      }
    } else {
      // Legacy path: no default checking → deficit triggers withdrawal directly (no
      // gross-up because the legacy path doesn't model the withdrawal tax separately).
      const legacyNetFlow = householdInflows - householdNonSavingsOutflows - savings.total;
      if (legacyNetFlow < 0) {
        withdrawals = executeWithdrawals(
          -legacyNetFlow,
          data.withdrawalStrategy,
          householdWithdrawBalances,
          year
        );
        for (const [acctId, amount] of Object.entries(withdrawals.byAccount)) {
          accountBalances[acctId] -= amount;
          if (accountLedgers[acctId]) {
            accountLedgers[acctId].distributions += amount;
            accountLedgers[acctId].endingValue -= amount;
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
    for (const acct of data.accounts) {
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

    // 14. Assemble the year. Tax line includes the additional withdrawal gross-up tax
    // so the cash-flow view reflects the full tax burden.
    const totalTaxes = taxes + withdrawalTax;
    const expenses = {
      living: expenseBreakdown.living,
      liabilities: liabResult.totalPayment,
      other: expenseBreakdown.other,
      insurance: expenseBreakdown.insurance,
      taxes: totalTaxes,
      total:
        expenseBreakdown.living +
        expenseBreakdown.other +
        expenseBreakdown.insurance +
        liabResult.totalPayment +
        totalTaxes,
      bySource: expenseBreakdown.bySource,
    };

    const totalIncome = income.total + withdrawals.total + householdRmdIncome;
    const totalExpenses = expenses.total + savings.total;
    const netCashFlow = totalIncome - totalExpenses;

    years.push({
      year,
      ages,
      income,
      withdrawals,
      expenses,
      savings,
      totalIncome,
      totalExpenses,
      netCashFlow,
      portfolioAssets,
      accountLedgers,
    });
  }

  return years;
}
