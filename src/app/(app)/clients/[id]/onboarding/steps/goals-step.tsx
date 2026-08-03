import IncomeExpensesView from "@/components/income-expenses-view";
import { loadCashFlowStepData } from "./cash-flow-step-data";

interface GoalsStepProps {
  clientId: string;
  firmId: string;
}

/**
 * Wizard step over IncomeExpensesView's `goals` section — education funding
 * and any other expense the advisor ticks "Show as a goal" on. Goals are
 * expenses, so this shares the Cash Flow step's loader; only the section
 * differs.
 */
export default async function GoalsStep({ clientId, firmId }: GoalsStepProps) {
  const data = await loadCashFlowStepData(clientId, firmId);
  if (!data) {
    return (
      <div className="rounded-[var(--radius-sm)] border border-dashed border-hair-2 bg-card-2/40 px-5 py-6 text-[13px] text-ink-3">
        No base case scenario found for this client.
      </div>
    );
  }

  return <IncomeExpensesView {...data} embed="wizard" section="goals" />;
}
