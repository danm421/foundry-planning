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

    // 1. Household income (excludes entity-owned income entirely — the entity keeps it).
    const income = computeIncome(
      data.incomes,
      year,
      client,
      (inc) => inc.ownerEntityId == null
    );

    // 1b. Grantor-trust income: not household income, but taxable at household rates.
    const grantorIncome = computeIncome(
      data.incomes,
      year,
      client,
      (inc) => inc.ownerEntityId != null && isGrantorEntity(inc.ownerEntityId)
    );

    // 2. Household expenses — entity-paid expenses don't hit household cash flow.
    const expenseBreakdown = computeExpenses(
      data.expenses,
      year,
      (exp) => exp.ownerEntityId == null
    );

    // 3. Liability payments for household-owed debts only.
    const liabResult = computeLiabilities(
      currentLiabilities,
      year,
      (liab) => liab.ownerEntityId == null
    );
    currentLiabilities = liabResult.updatedLiabilities;

    // 4. Grow every account's balance (we track all of them so grantor-trust RMDs can be
    // computed correctly and the portfolio snapshot can optionally roll them in).
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

    // 4b. RMDs — accounted for household accounts and grantor-trust accounts.
    // For household accounts the RMD is both income and taxable; for grantor accounts
    // it's taxable only (the entity keeps the cash). Non-grantor entity accounts are
    // skipped entirely from the household projection.
    let householdRmdIncome = 0;
    let grantorRmdTaxable = 0;
    for (const acct of data.accounts) {
      if (!acct.rmdEnabled) continue;
      const entityOwned = acct.ownerEntityId != null;
      if (entityOwned && !isGrantorEntity(acct.ownerEntityId)) continue;

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
      if (entityOwned) {
        grantorRmdTaxable += rmd;
      } else {
        householdRmdIncome += rmd;
      }
    }

    // 5. Taxes. Household income + household RMDs are taxed as before; grantor-trust
    // income and grantor RMDs are added on top since the household pays those too.
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

    // 6. Household net need (entity income is ignored here).
    const totalExpensesBeforeSavings =
      expenseBreakdown.living +
      expenseBreakdown.other +
      expenseBreakdown.insurance +
      liabResult.totalPayment +
      taxes;

    const netNeed = income.total + householdRmdIncome - totalExpensesBeforeSavings;

    // 7. Apply savings or withdrawals — household accounts only.
    let savings = { byAccount: {} as Record<string, number>, total: 0, employerTotal: 0 };
    let withdrawals = { byAccount: {} as Record<string, number>, total: 0 };

    if (netNeed > 0) {
      savings = applySavingsRules(
        data.savingsRules,
        year,
        netNeed,
        income.salaries
      );

      for (const [acctId, amount] of Object.entries(savings.byAccount)) {
        accountBalances[acctId] = (accountBalances[acctId] ?? 0) + amount;
        if (accountLedgers[acctId]) {
          accountLedgers[acctId].contributions += amount;
          accountLedgers[acctId].endingValue += amount;
        }
      }

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
    } else if (netNeed < 0) {
      // Withdrawals only draw from household-available accounts. Grantor-trust accounts
      // stay in the portfolio view but the trust controls distributions itself.
      const householdOnlyBalances: Record<string, number> = {};
      for (const acct of data.accounts) {
        if (acct.ownerEntityId != null) continue;
        householdOnlyBalances[acct.id] = accountBalances[acct.id] ?? 0;
      }
      withdrawals = executeWithdrawals(
        Math.abs(netNeed),
        data.withdrawalStrategy,
        householdOnlyBalances,
        year
      );

      for (const [acctId, amount] of Object.entries(withdrawals.byAccount)) {
        accountBalances[acctId] = (accountBalances[acctId] ?? 0) - amount;
        if (accountLedgers[acctId]) {
          accountLedgers[acctId].distributions += amount;
          accountLedgers[acctId].endingValue -= amount;
        }
      }
    }

    // 8. Portfolio assets snapshot. An account is included if it has no entity owner
    // or if its entity is flagged to roll into portfolio assets.
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

    // 9. Assemble the year
    const expenses = {
      living: expenseBreakdown.living,
      liabilities: liabResult.totalPayment,
      other: expenseBreakdown.other,
      insurance: expenseBreakdown.insurance,
      taxes,
      total: totalExpensesBeforeSavings,
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
