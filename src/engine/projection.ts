import type {
  ClientData,
  ProjectionYear,
  AccountLedger,
  Liability,
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

    // 1. Compute income
    const income = computeIncome(data.incomes, year, client);

    // 2. Compute expenses (excluding liabilities and taxes)
    const expenseBreakdown = computeExpenses(data.expenses, year);

    // 3. Compute liability payments and update balances
    const liabResult = computeLiabilities(currentLiabilities, year);
    currentLiabilities = liabResult.updatedLiabilities;

    // 4. Grow accounts (beginning-of-year growth)
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

    // 4b. Calculate and apply RMDs for eligible accounts
    let totalRmdIncome = 0;
    for (const acct of data.accounts) {
      if (!acct.rmdEnabled) continue;

      // Determine owner's birth year and age
      let ownerBirthYear: number;
      if (acct.owner === "spouse" && spouseBirthYear != null) {
        ownerBirthYear = spouseBirthYear;
      } else {
        ownerBirthYear = clientBirthYear;
      }
      const ownerAge = year - ownerBirthYear;

      const balance = accountBalances[acct.id] ?? 0;
      const rmd = calculateRMD(balance, ownerAge, ownerBirthYear);

      if (rmd > 0) {
        accountBalances[acct.id] = (accountBalances[acct.id] ?? 0) - rmd;
        if (accountLedgers[acct.id]) {
          accountLedgers[acct.id].rmdAmount = rmd;
          accountLedgers[acct.id].distributions += rmd;
          accountLedgers[acct.id].endingValue -= rmd;
        }
        totalRmdIncome += rmd;
      }
    }

    // 5. Calculate taxes
    const taxableIncome =
      income.salaries +
      income.business +
      income.deferred +
      income.capitalGains +
      income.trust +
      totalRmdIncome;
    const taxes = calculateTaxes(taxableIncome, planSettings);

    // 6. Determine net need
    const totalExpensesBeforeSavings =
      expenseBreakdown.living +
      expenseBreakdown.other +
      expenseBreakdown.insurance +
      liabResult.totalPayment +
      taxes;

    const netNeed = income.total + totalRmdIncome - totalExpensesBeforeSavings;

    // 7. Apply savings or withdrawals
    let savings = { byAccount: {} as Record<string, number>, total: 0, employerTotal: 0 };
    let withdrawals = { byAccount: {} as Record<string, number>, total: 0 };

    if (netNeed > 0) {
      // Surplus — save
      savings = applySavingsRules(
        data.savingsRules,
        year,
        netNeed,
        income.salaries
      );

      // Apply contributions to account balances and ledgers
      for (const [acctId, amount] of Object.entries(savings.byAccount)) {
        accountBalances[acctId] = (accountBalances[acctId] ?? 0) + amount;
        if (accountLedgers[acctId]) {
          accountLedgers[acctId].contributions += amount;
          accountLedgers[acctId].endingValue += amount;
        }
      }

      // Apply employer match contributions
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
      // Deficit — withdraw
      withdrawals = executeWithdrawals(
        Math.abs(netNeed),
        data.withdrawalStrategy,
        accountBalances,
        year
      );

      // Apply withdrawals to account balances and ledgers
      for (const [acctId, amount] of Object.entries(withdrawals.byAccount)) {
        accountBalances[acctId] = (accountBalances[acctId] ?? 0) - amount;
        if (accountLedgers[acctId]) {
          accountLedgers[acctId].distributions += amount;
          accountLedgers[acctId].endingValue -= amount;
        }
      }
    }

    // 8. Build portfolio assets snapshot
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

    const totalIncome = income.total + withdrawals.total + totalRmdIncome;
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
