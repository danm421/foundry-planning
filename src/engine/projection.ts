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
} from "./types";
import { computeIncome } from "./income";
import { computeExpenses } from "./expenses";
import { computeLiabilities } from "./liabilities";
import { calculateTaxes } from "./tax";
import { applySavingsRules } from "./savings";
import { executeWithdrawals } from "./withdrawal";
import { calculateRMD } from "./rmd";

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
      const entries: AccountLedgerEntry[] = [];
      if (growth !== 0) {
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
        accountLedgers[acct.id].entries.push({
          category: "rmd",
          label: `RMD distribution (age ${ownerAge})`,
          amount: -rmd,
        });
      }

      const rmdLabel = `RMD from ${acct.name}`;
      if (acct.ownerEntityId == null) {
        householdRmdIncome += rmd;
        creditCash(defaultChecking?.id, rmd, { category: "rmd", label: rmdLabel, sourceId: acct.id });
      } else {
        creditCash(entityCheckingByEntityId[acct.ownerEntityId], rmd, {
          category: "rmd",
          label: rmdLabel,
          sourceId: acct.id,
        });
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
      creditCash(resolveCashAccount(inc.ownerEntityId, inc.cashAccountId), amount, {
        category: "income",
        label: `Income: ${inc.name}`,
        sourceId: inc.id,
      });
    }

    // 7. Route each expense as an outflow from its cash account.
    for (const exp of data.expenses) {
      if (year < exp.startYear || year > exp.endYear) continue;
      const yearsElapsed = year - exp.startYear;
      const amount = exp.annualAmount * Math.pow(1 + exp.growthRate, yearsElapsed);
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
    // employer. Does not touch household checking.
    if (savings.employerTotal > 0) {
      for (const rule of data.savingsRules) {
        if (year < rule.startYear || year > rule.endYear) continue;
        if (rule.employerMatchPct != null && rule.employerMatchCap != null) {
          const match = income.salaries * rule.employerMatchCap * rule.employerMatchPct;
          if (match === 0) continue;
          accountBalances[rule.accountId] = (accountBalances[rule.accountId] ?? 0) + match;
          if (accountLedgers[rule.accountId]) {
            accountLedgers[rule.accountId].contributions += match;
            accountLedgers[rule.accountId].endingValue += match;
            accountLedgers[rule.accountId].entries.push({
              category: "employer_match",
              label: `Employer match (${(rule.employerMatchPct * 100).toFixed(0)}% on ${(rule.employerMatchCap * 100).toFixed(1)}% of salary)`,
              amount: match,
            });
          }
        }
      }
    }

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
              label: "Withdrawal to cover household shortfall",
              amount: -amount,
            });
          }
        }

        // Gross withdrawal lands in checking.
        accountBalances[checkingId] += withdrawals.total;
        if (accountLedgers[checkingId]) {
          accountLedgers[checkingId].contributions += withdrawals.total;
          accountLedgers[checkingId].endingValue += withdrawals.total;
          accountLedgers[checkingId].entries.push({
            category: "withdrawal",
            label: "Withdrawal to cover shortfall",
            amount: withdrawals.total,
          });
        }

        // Marginal tax on the gross withdrawal comes back out of checking and is
        // reported as additional taxes for the year.
        withdrawalTax = withdrawals.total * marginalRate;
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

    const totalIncome = income.total + householdRmdIncome;
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
