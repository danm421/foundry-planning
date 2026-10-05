"use client";

import { useMemo, useState } from "react";
import type { ClientData, Expense } from "@/engine/types";
import type { SolverMutation, SolverMutationKey } from "@/lib/solver/types";
import { goalContributionRule, withAdditionalContribution } from "@/lib/solver/solve-goal-dedicated-savings";
import { canHaveGoalFunding, goalDrawAccountIds } from "@/engine/goals/goal-funding";
import { SolverSection } from "./solver-section";
import { SolverFieldStepper } from "./solver-field-stepper";
import { SolverViewReportButton } from "./solver-view-report-button";
import { SolverEducationGoalForm, type EducationGoalFormAccount } from "./solver-education-goal-form";
import { SolverOtherGoalForm, type OtherGoalOwnerOption } from "./solver-other-goal-form";
import { useGoalSolve, type GoalSolveOutput } from "./use-goal-solve";

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
  /** CMA-resolved growth for a new 529 (retirement-category default). */
  growth529?: number;
  /** Household members who can own a new savings account (Other goals). */
  owners?: OtherGoalOwnerOption[];
  /** CMA-resolved growth for a new taxable savings account. */
  growthTaxable?: number;
  /** The plan's inflation rate — a new Other goal's cost grows with it. */
  inflationRate?: number;
  /** Switch the right pane to the Goals report. Omitted when that report is
   *  hidden in the advisor's layout — the button is then not shown. */
  onOpenReport?: () => void;
}

const DEFAULT_TARGET_PCT = 100;
const MIN_TARGET_PCT = 1;

/** What the solve found, in the advisor's words. A full-funding solve keeps the
 *  familiar wording; a partial one names the target it was asked for. */
function solveLabel(result: GoalSolveOutput): string {
  const pct = Math.round(result.targetPct * 100);
  const full = pct >= 100;
  if (!result.reachesTarget) {
    return full
      ? "Can’t fully fund from this source alone within the horizon."
      : `Can’t reach ${pct}% funded from this source alone within the horizon.`;
  }
  if (result.additionalAnnual <= 0) {
    return full ? "Already fully funded — no change needed." : `Already ${pct}% funded — no change needed.`;
  }
  const amount = `+$${Math.round(result.additionalAnnual).toLocaleString()}/yr`;
  return full ? `${amount} fully funds the gap` : `${amount} funds ${pct}% of this goal`;
}

function ownerFamilyMemberIds(acct: {
  owners?: { kind: string; familyMemberId?: string }[];
}): string[] {
  return (acct.owners ?? [])
    .filter((o) => o.kind === "family_member" && o.familyMemberId)
    .map((o) => o.familyMemberId!);
}

export function SolverGoalsSection({
  baseExpenses,
  workingTree,
  currentYear,
  clientId,
  source,
  mutations,
  onChange,
  growth529 = 0.05,
  owners = [],
  growthTaxable = 0.05,
  inflationRate = 0.03,
  onOpenReport,
}: Props) {
  // Every goal that may carry savings accounts (spec 2026-10-05, §3):
  // education, and Other expenses marked as goals — in start-year order.
  const goals = workingTree.expenses
    .filter(canHaveGoalFunding)
    .sort((a, b) => a.startYear - b.startYear);
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
        // A 529's owners are deliberately empty (out of estate); its
        // beneficiary is who the money is FOR, and only labels the row.
        beneficiaryFamilyMemberId: a.education529?.beneficiaryFamilyMemberId ?? null,
        beneficiaryName: a.education529?.beneficiaryName ?? null,
        isDefaultChecking: a.isDefaultChecking ?? false,
      })),
    [workingTree.accounts],
  );
  const beneficiaries = useMemo(
    () =>
      (workingTree.familyMembers ?? []).map((fm) => ({
        familyMemberId: fm.id,
        label: `${fm.firstName}${fm.lastName ? ` ${fm.lastName}` : ""}`,
      })),
    [workingTree.familyMembers],
  );

  const [adding, setAdding] = useState<null | "choose" | "education" | "other">(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [solveResult, setSolveResult] = useState<Record<string, GoalSolveOutput>>({});
  // Per-source funding target, in whole percent. Absent = 100 (fund it fully) —
  // an advisor covering only part of a bill dials this down before solving.
  const [targetPct, setTargetPct] = useState<Record<string, number>>({});
  const { pendingKey, run } = useGoalSolve({ clientId, source, mutations, currentYear });

  function upsertGoal(expense: Expense, newMutations: SolverMutation[]) {
    // Emit new-account + savings-rule mutations FIRST so the expense's
    // dedicatedAccountIds references an account already in the working tree.
    for (const m of newMutations) onChange(m);
    onChange({ kind: "expense-upsert", id: expense.id, value: expense });
    setAdding(null);
    setEditingId(null);
  }

  function removeGoal(id: string) {
    onChange({ kind: "expense-upsert", id, value: null });
  }

  // The goal's own contribution on an account — the same rule the solve and
  // Apply raise, so the stepper never edits a household rule that runs past
  // the goal (or no longer runs at all).
  function contributionRule(goal: Expense, accountId: string) {
    return goalContributionRule(workingTree, goal, accountId, currentYear);
  }

  function setContribution(goal: Expense, accountId: string, amount: number) {
    const rule = contributionRule(goal, accountId);
    onChange({ kind: "savings-rule-upsert", id: rule.id, value: { ...rule, annualAmount: amount } });
  }

  async function solveSource(goal: Expense, accountId: string) {
    const key = `${goal.id}:${accountId}`;
    const out = await run(goal.id, accountId, (targetPct[key] ?? DEFAULT_TARGET_PCT) / 100);
    if (out) setSolveResult((prev) => ({ ...prev, [key]: out }));
  }

  function applySolve(goal: Expense, accountId: string, additional: number) {
    // Model-matches-application: build the candidate tree the SAME way the solve
    // modeled it (withAdditionalContribution), then upsert the resulting rule.
    const built = withAdditionalContribution(workingTree, goal, accountId, additional, currentYear);
    const ruleId = contributionRule(goal, accountId).id;
    const rule = built.savingsRules.find((r) => r.id === ruleId)!;
    onChange({ kind: "savings-rule-upsert", id: rule.id, value: rule });
    setSolveResult((prev) => {
      const next = { ...prev };
      delete next[`${goal.id}:${accountId}`];
      return next;
    });
  }

  return (
    <SolverSection
      title="Goals"
      action={
        onOpenReport ? (
          <SolverViewReportButton reportLabel="Goals" onClick={onOpenReport} />
        ) : undefined
      }
    >
      {goals.length === 0 ? (
        <div className="text-[12px] text-ink-3">No goals yet.</div>
      ) : (
        <div className="flex flex-col gap-y-5">
          {goals.map((goal) => {
            const baseGoal = baseExpenses.find((e) => e.id === goal.id);
            const fundingIds = goalDrawAccountIds(goal, accountsById);
            return (
              <div key={goal.id} className="rounded-md border border-hair-2 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <div data-testid="goal-name" className="flex-1 text-[13px] font-medium text-ink">{goal.name}</div>
                  <span className="rounded border border-hair-2 px-1.5 text-[10px] uppercase tracking-wide text-ink-3">
                    {goal.type === "education" ? "Education" : "Goal"}
                  </span>
                  <button
                    type="button"
                    aria-label={`Edit ${goal.name}`}
                    onClick={() => {
                      setEditingId(goal.id);
                      setAdding(null);
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

                <SolverFieldStepper
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
                  {fundingIds.length === 0 && goal.type === "other" ? (
                    <div className="flex items-center gap-2 text-[12px] text-ink-3">
                      <span className="flex-1">Paid from cash flow</span>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(goal.id);
                          setAdding(null);
                        }}
                        className="rounded border border-hair-2 px-2 py-0.5 text-[11px] text-ink-3 hover:text-ink"
                      >
                        + Add savings account
                      </button>
                    </div>
                  ) : null}
                  {fundingIds.map((accountId) => {
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
                          <span className="shrink-0 whitespace-nowrap text-[11px] text-ink-3">Fund to</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={MIN_TARGET_PCT}
                            max={100}
                            step={5}
                            aria-label={`Fund ${acct?.name ?? accountId} to percent`}
                            value={targetPct[key] ?? DEFAULT_TARGET_PCT}
                            onChange={(e) => {
                              const n = parseInt(e.target.value, 10);
                              if (Number.isNaN(n)) return;
                              setTargetPct((prev) => ({
                                ...prev,
                                [key]: Math.min(100, Math.max(MIN_TARGET_PCT, n)),
                              }));
                            }}
                            className="h-6 w-12 shrink-0 rounded border border-hair-2 bg-card-2 px-1 text-right text-[11px] text-ink tabular focus:border-accent focus:outline-none"
                          />
                          <span className="shrink-0 text-[11px] text-ink-3">%</span>
                          <button
                            type="button"
                            aria-label={`Solve ${acct?.name ?? accountId}`}
                            disabled={solving}
                            onClick={() => solveSource(goal, accountId)}
                            className="shrink-0 rounded border border-hair-2 px-2 py-0.5 text-[11px] text-ink-3 hover:text-ink disabled:opacity-50"
                          >
                            {solving ? "Solving…" : "Solve"}
                          </button>
                        </div>
                        <SolverFieldStepper
                          id={`edu-contrib-${key}`}
                          label={`${acct?.name ?? accountId} annual contribution`}
                          value={contributionRule(goal, accountId).annualAmount}
                          min={0}
                          max={100_000}
                          step={500}
                          prefix="$"
                          onCommit={(n) => setContribution(goal, accountId, n)}
                        />
                        {result ? (
                          result.reachesTarget ? (
                            <div className="mt-1 flex items-center gap-2 text-[11px] text-ink-2">
                              <span>{solveLabel(result)}</span>
                              {result.additionalAnnual > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => applySolve(goal, accountId, result.additionalAnnual)}
                                  className="rounded bg-accent/20 px-2 py-0.5 font-medium text-ink"
                                >
                                  Apply
                                </button>
                              ) : null}
                            </div>
                          ) : (
                            <div className="mt-1 text-[11px] text-ink-3">{solveLabel(result)}</div>
                          )
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                {editingId === goal.id ? (
                  goal.type === "education" ? (
                    <SolverEducationGoalForm
                      mode="edit"
                      initial={goal}
                      accounts={pickerAccounts}
                      beneficiaries={beneficiaries}
                      growth529={growth529}
                      currentYear={currentYear}
                      onSubmit={upsertGoal}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                    <SolverOtherGoalForm
                      mode="edit"
                      initial={goal}
                      accounts={pickerAccounts}
                      owners={owners}
                      growthTaxable={growthTaxable}
                      inflationRate={inflationRate}
                      currentYear={currentYear}
                      onSubmit={upsertGoal}
                      onCancel={() => setEditingId(null)}
                    />
                  )
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {adding === "education" ? (
        <SolverEducationGoalForm
          mode="add"
          accounts={pickerAccounts}
          beneficiaries={beneficiaries}
          growth529={growth529}
          currentYear={currentYear}
          onSubmit={upsertGoal}
          onCancel={() => setAdding(null)}
        />
      ) : adding === "other" ? (
        <SolverOtherGoalForm
          mode="add"
          accounts={pickerAccounts}
          owners={owners}
          growthTaxable={growthTaxable}
          inflationRate={inflationRate}
          currentYear={currentYear}
          onSubmit={upsertGoal}
          onCancel={() => setAdding(null)}
        />
      ) : adding === "choose" ? (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAdding("education")}
            className="rounded-md border border-hair-2 px-3 py-1.5 text-[12px] font-medium text-ink-3 hover:text-ink"
          >
            Education goal
          </button>
          <button
            type="button"
            onClick={() => setAdding("other")}
            className="rounded-md border border-hair-2 px-3 py-1.5 text-[12px] font-medium text-ink-3 hover:text-ink"
          >
            Other goal
          </button>
          <button
            type="button"
            onClick={() => setAdding(null)}
            className="px-2 text-[12px] text-ink-3 hover:text-ink"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setAdding("choose");
            setEditingId(null);
          }}
          className="mt-2 rounded-md border border-hair-2 px-3 py-1.5 text-[12px] font-medium text-ink-3 hover:text-ink"
        >
          + Add goal
        </button>
      )}
    </SolverSection>
  );
}
