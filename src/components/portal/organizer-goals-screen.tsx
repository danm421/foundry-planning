import type { ReactElement } from "react";
import GoalsBoard from "@/components/household-map/goals-board";
import { loadOrganizerMap } from "@/lib/portal/load-organizer-map";

/**
 * Organizer → Goals. The same board the advisor sees on the Household Map,
 * fed by the same builder over the same base tree.
 *
 * READ-ONLY in this phase: no `onEditGoalExpense`, no `onAddGoal`, and
 * `expenseRows: {}` so `GoalsBoard`'s writability probe fails for every card and
 * each one renders as a plain div rather than a button that does nothing.
 *
 * `onSaveLifeExpectancy` is omitted permanently, not just for this phase. Those
 * cards move the plan horizon (`client.planEndAge` + `planSettings.planEndYear`)
 * and that is an advisor lever — the board falls back to its static detail line.
 */
export default async function OrganizerGoalsScreen({
  clientId,
}: {
  clientId: string;
}): Promise<ReactElement> {
  const data = await loadOrganizerMap(clientId);

  if (!data) {
    return (
      <div className="p-5 text-[13px] text-ink-3">
        Your goals timeline isn&apos;t ready yet — your advisor is still setting up
        your plan.
      </div>
    );
  }

  return (
    <div className="p-5">
      <GoalsBoard
        people={data.people}
        goals={data.goals}
        canEdit={false}
        expenseRows={{}}
      />
    </div>
  );
}
