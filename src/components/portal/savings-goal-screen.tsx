import type { ReactElement } from "react";
import { loadSavingsGoal } from "@/lib/portal/load-savings-goal";
import { SavingsGoalWorkspace } from "@/components/portal/savings-goal-workspace";

export async function SavingsGoalScreen({
  clientId,
  readOnly = false,
}: {
  clientId: string;
  /** Advisor preview: renders and runs the numbers, but never autosaves. */
  readOnly?: boolean;
}): Promise<ReactElement> {
  const dto = await loadSavingsGoal(clientId);
  return <SavingsGoalWorkspace dto={dto} readOnly={readOnly} />;
}
