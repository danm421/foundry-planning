import IncomeExpensesView from "@/components/income-expenses-view";
import { loadIncomeExpensesViewProps } from "./load-view-props";

interface IncomeExpensesContentProps {
  clientId: string;
  scenarioParam: string | undefined;
}

export async function IncomeExpensesContent({ clientId, scenarioParam }: IncomeExpensesContentProps) {
  const result = await loadIncomeExpensesViewProps(clientId, scenarioParam);

  if (result.status === "no-base-case") {
    return (
      <div className="rounded-lg border border-hair bg-card p-6 text-center text-ink-2">
        No base case scenario found.
      </div>
    );
  }

  return <IncomeExpensesView {...result.props} />;
}
