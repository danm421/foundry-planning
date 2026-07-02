"use client";

import { useMemo, useState } from "react";
import type { ClientData, Expense, SavingsRule } from "@/engine/types";
import type { SolverMutation, SolverMutationKey } from "@/lib/solver/types";
import { withAdditionalContribution } from "@/lib/solver/solve-education-dedicated-savings";
import { SolverSection } from "./solver-section";
import { SolverFieldSlider } from "./solver-field-slider";
import { SolverEducationGoalForm, type EducationGoalFormAccount } from "./solver-education-goal-form";
import { useEducationSolve, type EducationSolveOutput } from "./use-education-solve";

interface Props {
  baseExpenses: Expense[];
  workingTree: ClientData;
  currentYear: number;
  clientId: string;
  source: string;
  mutations: SolverMutation[];
  onChange: (m: SolverMutation) => void;
  /** Accepted for API symmetry with sibling sections; unused in v1 (goal edits
   *  flow through expense-upsert, which carries its own reset semantics). */
  onResetField?: (keys: SolverMutationKey[]) => void;
}

function ownerFamilyMemberIds(acct: { owners?: { kind: string; familyMemberId?: string }[] }): string[] {
  return (acct.owners ?? [])
    .filter((o) => o.kind === "family_member" && o.familyMemberId)
    .map((o) => o.familyMemberId!);
}

export function SolverEducationSection({
  baseExpenses,
  workingTree,
  currentYear,
  clientId,
  source,
  mutations,
  onChange,
}: Props) {
  const goals = workingTree.expenses.filter((e) => e.type === "education");
  const accountsById = useMemo(
    () => new Map(workingTree.accounts.map((a) => [a.id, a])),
    [workingTree.accounts],
  );
  const pickerAccounts: EducationGoalFormAccount[] = useMemo(
    () =>
      workingTree.accounts.map((a) => ({
        id: a.id,
        name: a.name,
        category: a.category,
        subType: a.subType ?? "",
        ownerFamilyMemberIds: ownerFamilyMemberIds(a as never),
      })),
    [workingTree.accounts],
  );

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [solveResult, setSolveResult] = useState<Record<string, EducationSolveOutput>>({});
  const { pendingKey, run } = useEducationSolve({ clientId, source, mutations });

  function upsertGoal(expense: Expense) {
    onChange({ kind: "expense-upsert", id: expense.id, value: expense });
    setAdding(false);
    setEditingId(null);
  }

  function removeGoal(id: string) {
    onChange({ kind: "expense-upsert", id, value: null });
  }

  function contributionRuleFor(accountId: string): SavingsRule | undefined {
    return workingTree.savingsRules.find((r) => r.accountId === accountId);
  }

  function currentContribution(accountId: string): number {
    return contributionRuleFor(accountId)?.annualAmount ?? 0;
  }

  function setContribution(accountId: string, amount: number) {
    const existing = contributionRuleFor(accountId);
    if (existing) {
      onChange({
        kind: "savings-rule-upsert",
        id: existing.id,
        value: { ...existing, annualAmount: amount },
      });
    } else {
      const rule: SavingsRule = {
        id: `edu-solve-${accountId}`,
        accountId,
        annualAmount: amount,
        isDeductible: false,
        startYear: currentYear,
        endYear: currentYear,
      };
      onChange({ kind: "savings-rule-upsert", id: rule.id, value: rule });
    }
  }

  async function solveSource(goal: Expense, accountId: string) {
    const key = `${goal.id}:${accountId}`;
    const out = await run(goal.id, accountId);
    if (out) setSolveResult((prev) => ({ ...prev, [key]: out }));
  }

  function applySolve(goal: Expense, accountId: string, additional: number) {
    // Model-matches-application: build the candidate tree the SAME way the solve
    // modeled it (withAdditionalContribution), then upsert the resulting rule.
    const built = withAdditionalContribution(workingTree, accountId, additional, currentYear, goal.endYear);
    const rule = built.savingsRules.find((r) => r.accountId === accountId)!;
    onChange({ kind: "savings-rule-upsert", id: rule.id, value: rule });
    setSolveResult((prev) => {
      const next = { ...prev };
      delete next[`${goal.id}:${accountId}`];
      return next;
    });
  }

  return (
    <SolverSection title="Education">
      {goals.length === 0 ? (
        <div className="text-[12px] text-ink-3">No education goals yet.</div>
      ) : (
        <div className="flex flex-col gap-y-5">
          {goals.map((goal) => {
            const baseGoal = baseExpenses.find((e) => e.id === goal.id);
            return (
              <div key={goal.id} className="rounded-md border border-hair-2 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <div className="flex-1 text-[13px] font-medium text-ink">{goal.name}</div>
                  <button
                    type="button"
                    aria-label={`Edit ${goal.name}`}
                    onClick={() => {
                      setEditingId(goal.id);
                      setAdding(false);
                    }}
                    className="text-[12px] text-ink-3 hover:text-ink"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${goal.name}`}
                    onClick={() => removeGoal(goal.id)}
                    className="text-[12px] text-ink-3 hover:text-ink"
                  >
                    ✕
                  </button>
                </div>

                <SolverFieldSlider
                  id={`edu-cost-${goal.id}`}
                  label={`${goal.name} annual cost`}
                  value={goal.annualAmount}
                  min={0}
                  max={Math.max(100_000, (baseGoal?.annualAmount ?? goal.annualAmount) * 2)}
                  step={1_000}
                  prefix="$"
                  onCommit={(n) =>
                    onChange({ kind: "expense-upsert", id: goal.id, value: { ...goal, annualAmount: n } })
                  }
                />

                <div className="mt-3 flex flex-col gap-2">
                  {(goal.dedicatedAccountIds ?? []).map((accountId) => {
                    const acct = accountsById.get(accountId);
                    const key = `${goal.id}:${accountId}`;
                    const result = solveResult[key];
                    const solving = pendingKey === key;
                    return (
                      <div key={accountId} className="rounded border border-hair p-2">
                        <div className="mb-1 flex items-center gap-2">
                          <div className="flex-1 truncate text-[12px] text-ink-2">
                            {acct?.name ?? accountId}
                          </div>
                          <button
                            type="button"
                            aria-label={`Solve ${acct?.name ?? accountId}`}
                            disabled={solving}
                            onClick={() => solveSource(goal, accountId)}
                            className="rounded border border-hair-2 px-2 py-0.5 text-[11px] text-ink-3 hover:text-ink disabled:opacity-50"
                          >
                            {solving ? "Solving…" : "Solve"}
                          </button>
                        </div>
                        <SolverFieldSlider
                          id={`edu-contrib-${key}`}
                          label={`${acct?.name ?? accountId} annual contribution`}
                          value={currentContribution(accountId)}
                          min={0}
                          max={100_000}
                          step={500}
                          prefix="$"
                          onCommit={(n) => setContribution(accountId, n)}
                        />
                        {result ? (
                          result.fundsFully ? (
                            <div className="mt-1 flex items-center gap-2 text-[11px] text-ink-2">
                              <span>
                                +${Math.round(result.additionalAnnual).toLocaleString()}/yr fully funds the gap
                              </span>
                              <button
                                type="button"
                                onClick={() => applySolve(goal, accountId, result.additionalAnnual)}
                                className="rounded bg-accent/20 px-2 py-0.5 font-medium text-ink"
                              >
                                Apply
                              </button>
                            </div>
                          ) : (
                            <div className="mt-1 text-[11px] text-ink-3">
                              Can’t fully fund from this source alone within the horizon.
                            </div>
                          )
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                {editingId === goal.id ? (
                  <SolverEducationGoalForm
                    mode="edit"
                    initial={goal}
                    accounts={pickerAccounts}
                    currentYear={currentYear}
                    onSubmit={upsertGoal}
                    onCancel={() => setEditingId(null)}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {adding ? (
        <SolverEducationGoalForm
          mode="add"
          accounts={pickerAccounts}
          currentYear={currentYear}
          onSubmit={upsertGoal}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setAdding(true);
            setEditingId(null);
          }}
          className="mt-2 rounded-md border border-hair-2 px-3 py-1.5 text-[12px] font-medium text-ink-3 hover:text-ink"
        >
          + Add education goal
        </button>
      )}
    </SolverSection>
  );
}
