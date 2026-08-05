"use client";

// Client shell for Organizer → Goals. A goal IS an expense carrying `isGoal`,
// so every write here goes through the expense routes — there is no goal
// endpoint and there should not be one.
//
// Unlike the Cash Flow tab, the add affordance IS a header-bar button here:
// `GoalsBoard` gates its own centred "Add goal" on `canEdit && onAddGoal`
// (goals-board.tsx:201), so withholding the callback suppresses it and leaves
// exactly one button on the page. `CashFlowBoard` gates its band buttons on
// `canEdit` alone, which is why that tab uses the board's own — see
// organizer-cash-flow-client.tsx.

import { useState, type ReactElement } from "react";
import GoalsBoard from "@/components/household-map/goals-board";
import {
  OrganizerFlowFormPanel,
  type FlowFormTarget,
} from "@/components/portal/organizer-flow-form-panel";
import type { OrganizerMapData } from "@/lib/portal/load-organizer-map";

export default function OrganizerGoalsClient({
  data,
}: {
  data: OrganizerMapData;
}): ReactElement {
  const [target, setTarget] = useState<FlowFormTarget | null>(null);

  function handleEditGoalExpense(expenseId: string) {
    const row = data.expenseRows[expenseId];
    if (!data.canEdit || !row) return;
    setTarget({ kind: "expense", id: expenseId, row });
  }

  return (
    <>
      {data.canEdit && (
        <div className="flex gap-2 border-b border-hair px-5 py-3">
          <button
            type="button"
            onClick={() => setTarget({ kind: "expense", id: null, row: null, presetIsGoal: true })}
            className="rounded-md border border-accent bg-accent/15 px-3 py-1.5 text-[13px] font-medium text-accent"
          >
            Add goal
          </button>
        </div>
      )}

      <div className="p-5">
        <GoalsBoard
          people={data.people}
          goals={data.goals}
          canEdit={data.canEdit}
          // Membership is the writability probe — the map is already filtered by
          // the portal predicates server-side. A life milestone has
          // `expenseId: null` and is never in it.
          expenseRows={data.expenseRows}
          onEditGoalExpense={handleEditGoalExpense}
          // `onAddGoal` is deliberately NOT passed: the board would render its
          // own centred "Add goal" a few pixels below the header bar one.
          // `onSaveLifeExpectancy` is deliberately NOT passed: those cards move
          // the plan horizon and that is an advisor lever.
        />
      </div>

      {target && (
        <OrganizerFlowFormPanel
          key={`expense:${target.id ?? "new"}`}
          target={target}
          clientFirstName={data.people.client.firstName}
          spouseFirstName={data.people.spouse?.firstName ?? null}
          savingsAccountOptions={data.savingsAccountOptions}
          milestones={data.milestones}
          onClose={() => setTarget(null)}
          onSaved={() => setTarget(null)}
        />
      )}
    </>
  );
}
