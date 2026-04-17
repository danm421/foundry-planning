import { db } from "@/db";
import { clients, scenarios, clientDeductions, savingsRules, accounts, expenses, liabilities } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { redirect } from "next/navigation";
import { amortizeLiability } from "@/engine/liabilities";
import { DeductionsClient } from "./deductions-client";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function DeductionsPage({ params }: PageProps) {
  const firmId = await getOrgId();
  const { id } = await params;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) redirect("/clients");

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, id), eq(scenarios.isBaseCase, true)));

  if (!scenario) {
    return <div className="p-6 text-sm text-gray-400">No base case scenario found.</div>;
  }

  const [deductionRows, savingsRows, accountRows, expenseRows, liabilityRows] = await Promise.all([
    db.select().from(clientDeductions).where(and(eq(clientDeductions.clientId, id), eq(clientDeductions.scenarioId, scenario.id))),
    db.select().from(savingsRules).where(and(eq(savingsRules.clientId, id), eq(savingsRules.scenarioId, scenario.id))),
    db.select().from(accounts).where(and(eq(accounts.clientId, id), eq(accounts.scenarioId, scenario.id))),
    db.select().from(expenses).where(and(eq(expenses.clientId, id), eq(expenses.scenarioId, scenario.id))),
    db.select().from(liabilities).where(and(eq(liabilities.clientId, id), eq(liabilities.scenarioId, scenario.id))),
  ]);

  // ── Current year + SALT cap ─────────────────────────────────────────────
  const currentYear = new Date().getFullYear();
  const saltCap = currentYear >= 2026 ? 40000 : 10000;

  // ── 1. Savings-derived above-line rows ──────────────────────────────────
  const derivedRows = savingsRows
    .filter((r) => {
      const acct = accountRows.find((a) => a.id === r.accountId);
      if (!acct) return false;
      if (acct.subType !== "traditional_ira" && acct.subType !== "401k") return false;
      if (currentYear < r.startYear || currentYear > r.endYear) return false;
      return true;
    })
    .map((r) => {
      const acct = accountRows.find((a) => a.id === r.accountId)!;
      return {
        id: r.id,
        accountName: acct.name,
        subType: acct.subType ?? "",
        annualAmount: parseFloat(r.annualAmount),
        owner: acct.owner,
        startYear: r.startYear,
        endYear: r.endYear,
      };
    });

  // ── 2. Expense-derived deductions ───────────────────────────────────────
  const expenseDeductionRows = expenseRows
    .filter((e) => e.deductionType !== null)
    .map((e) => ({
      id: e.id,
      name: e.name,
      deductionType: e.deductionType!,
      annualAmount: parseFloat(e.annualAmount),
    }));

  // ── 3. Mortgage interest (below-line) ───────────────────────────────────
  const mortgageRows = liabilityRows
    .filter((l) => l.isInterestDeductible)
    .map((l) => {
      const result = amortizeLiability(
        {
          id: l.id,
          name: l.name,
          balance: parseFloat(l.balance),
          interestRate: parseFloat(l.interestRate),
          monthlyPayment: parseFloat(l.monthlyPayment),
          startYear: l.startYear,
          startMonth: l.startMonth,
          termMonths: l.termMonths,
          extraPayments: [],
        },
        currentYear,
      );
      return {
        id: l.id,
        name: l.name,
        estimatedInterest: result.interestPortion,
      };
    })
    .filter((r) => r.estimatedInterest > 0);

  // ── 4. Property tax / SALT ──────────────────────────────────────────────
  const propertyTaxRows = accountRows
    .filter((a) => parseFloat(a.annualPropertyTax) > 0)
    .map((a) => {
      const baseTax = parseFloat(a.annualPropertyTax);
      const growthRate = parseFloat(a.propertyTaxGrowthRate);
      // Inflate from the account's creation year (approximated by current year
      // for existing accounts). For a precise base, we use years elapsed = 0
      // for the current year, meaning currentYearInflated === baseTax * (1 + g)^0.
      // In practice, the base amount is already "today's dollars", so year-0 = now.
      const currentYearInflated = baseTax * Math.pow(1 + growthRate, 0);
      return {
        id: a.id,
        name: a.name,
        annualPropertyTax: baseTax,
        currentYearInflated,
      };
    });

  // ── Manual itemized rows ────────────────────────────────────────────────
  const itemizedRows = deductionRows.map((d) => ({
    id: d.id,
    type: d.type,
    name: d.name,
    owner: d.owner,
    annualAmount: parseFloat(d.annualAmount),
    growthRate: parseFloat(d.growthRate),
    startYear: d.startYear,
    endYear: d.endYear,
    startYearRef: d.startYearRef,
    endYearRef: d.endYearRef,
  }));

  return (
    <DeductionsClient
      clientId={id}
      derivedRows={derivedRows}
      expenseDeductionRows={expenseDeductionRows}
      mortgageRows={mortgageRows}
      propertyTaxRows={propertyTaxRows}
      itemizedRows={itemizedRows}
      currentYear={currentYear}
      saltCap={saltCap}
    />
  );
}
