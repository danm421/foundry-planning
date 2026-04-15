import { notFound } from "next/navigation";
import { db } from "@/db";
import { clients, scenarios, accounts, incomes, expenses, savingsRules, withdrawalStrategies } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import IncomeExpensesView from "@/components/income-expenses-view";

interface IncomeExpensesPageProps {
  params: Promise<{ id: string }>;
}

export default async function IncomeExpensesPage({ params }: IncomeExpensesPageProps) {
  const firmId = await getOrgId();
  const { id } = await params;

  // Verify client access
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) {
    notFound();
  }

  // Get base case scenario
  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, id), eq(scenarios.isBaseCase, true)));

  if (!scenario) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-500">
        No base case scenario found.
      </div>
    );
  }

  // Fetch all data in parallel
  const [incomeRows, expenseRows, savingsRuleRows, withdrawalRows, accountRows] = await Promise.all([
    db.select().from(incomes).where(and(eq(incomes.clientId, id), eq(incomes.scenarioId, scenario.id))),
    db.select().from(expenses).where(and(eq(expenses.clientId, id), eq(expenses.scenarioId, scenario.id))),
    db.select().from(savingsRules).where(and(eq(savingsRules.clientId, id), eq(savingsRules.scenarioId, scenario.id))),
    db.select().from(withdrawalStrategies).where(and(eq(withdrawalStrategies.clientId, id), eq(withdrawalStrategies.scenarioId, scenario.id))),
    db.select().from(accounts).where(and(eq(accounts.clientId, id), eq(accounts.scenarioId, scenario.id))),
  ]);

  return (
    <IncomeExpensesView
      clientId={id}
      initialIncomes={incomeRows}
      initialExpenses={expenseRows}
      initialSavingsRules={savingsRuleRows}
      initialWithdrawalStrategies={withdrawalRows}
      accounts={accountRows}
    />
  );
}
