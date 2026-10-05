"use client";

import { useState } from "react";
import type { Expense } from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";
import { DedicatedFundingPicker } from "@/components/forms/dedicated-funding-picker";
import { buildQuickAddAccount } from "@/lib/solver/quick-add-account";
import { defaultPayShortfallOutOfPocket } from "@/lib/goals";
import type { EducationGoalFormAccount } from "./solver-education-goal-form";

/** A household member who can own a new savings account. */
export interface OtherGoalOwnerOption {
  familyMemberId: string;
  label: string;
}

interface Props {
  mode: "add" | "edit";
  initial?: Expense;
  accounts: EducationGoalFormAccount[];
  owners: OtherGoalOwnerOption[];
  /** CMA-resolved growth for a new taxable savings account. */
  growthTaxable: number;
  /** The plan's inflation rate — a new goal's cost grows with it. */
  inflationRate: number;
  currentYear: number;
  onSubmit: (expense: Expense, newMutations: SolverMutation[]) => void;
  onCancel: () => void;
}

const inputClass = "mt-1 w-full rounded border border-hair-2 bg-card px-2 py-1 text-ink";

/** Owner-select value for a new account owned jointly by the first two owners. */
const JOINT = "joint";

/**
 * Add or edit an Other goal on the Solver Goals tab (spec
 * 2026-10-05-solver-goals-design, §3): a one-off or recurring cost, paid from
 * savings accounts the advisor picks or creates here, with cash flow as the
 * backstop when "Pay shortfall out of pocket" is on.
 */
export function SolverOtherGoalForm({
  mode, initial, accounts, owners, growthTaxable, inflationRate, currentYear, onSubmit, onCancel,
}: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [annualAmount, setAnnualAmount] = useState(String(initial?.annualAmount ?? ""));
  const [startYear, setStartYear] = useState(String(initial?.startYear ?? currentYear + 1));
  const [years, setYears] = useState(
    String(initial ? Math.max(1, initial.endYear - initial.startYear + 1) : 1),
  );
  const [dedicatedAccountIds, setDedicatedAccountIds] = useState<string[]>(initial?.dedicatedAccountIds ?? []);
  // A goal that already has savings accounts shows what it stored; one that
  // never had any starts on (`defaultPayShortfallOutOfPocket`, Decision 3).
  const [payOutOfPocket, setPayOutOfPocket] = useState(
    (initial?.dedicatedAccountIds?.length ?? 0) > 0
      ? (initial?.payShortfallOutOfPocket ?? false)
      : defaultPayShortfallOutOfPocket({ type: "other", isGoal: true }),
  );

  // Pending new savings account. A stable id lets it appear (checked) in the
  // picker before it's built on submit; it is "open" exactly while that id sits
  // in the draw list, so unchecking it and "Remove" are the same action.
  const [newId] = useState(() => crypto.randomUUID());
  const [newName, setNewName] = useState("");
  const [newNameDirty, setNewNameDirty] = useState(false);
  // A married household's new account is joint unless the advisor picks one owner.
  const [newOwnerId, setNewOwnerId] = useState(
    owners.length > 1 ? JOINT : (owners[0]?.familyMemberId ?? ""),
  );
  const [newBalance, setNewBalance] = useState("");
  const [newAnnual, setNewAnnual] = useState("");
  const addingNew = dedicatedAccountIds.includes(newId);
  const newNameValue = newNameDirty ? newName : `${name.trim() || "Goal"} fund`;
  const joint = newOwnerId === JOINT;
  const newOwnerIds = joint
    ? owners.slice(0, 2).map((o) => o.familyMemberId)
    : newOwnerId ? [newOwnerId] : [];
  const newOwnerLabel = joint ? "Joint" : (owners.find((o) => o.familyMemberId === newOwnerId)?.label ?? "");

  const pickerAccounts: EducationGoalFormAccount[] = addingNew
    ? [
        ...accounts,
        {
          id: newId,
          name: `${newNameValue} (new)`,
          category: "taxable",
          subType: "brokerage",
          ownerFamilyMemberIds: newOwnerIds,
        },
      ]
    : accounts;

  function submit() {
    const start = Number(startYear) || currentYear + 1;
    const end = start + Math.max(1, Number(years) || 1) - 1;
    const amount = Number(annualAmount) || 0;
    const emitNew = addingNew && newOwnerIds.length > 0;
    const ids = emitNew ? dedicatedAccountIds : dedicatedAccountIds.filter((id) => id !== newId);
    // Moving the years un-anchors them: a stale milestone ref would re-resolve
    // the old year on the next load and silently undo the edit.
    const yearsMoved = !!initial && (initial.startYear !== start || initial.endYear !== end);

    const expense: Expense = {
      ...initial,
      id: initial?.id ?? crypto.randomUUID(),
      type: "other",
      isGoal: true,
      name: name.trim() || "Goal",
      annualAmount: amount,
      startYear: start,
      endYear: end,
      growthRate: initial?.growthRate ?? inflationRate,
      dedicatedAccountIds: ids,
      payShortfallOutOfPocket:
        ids.length > 0 ? payOutOfPocket : defaultPayShortfallOutOfPocket({ type: "other", isGoal: true }),
      ...(yearsMoved ? { startYearRef: null, endYearRef: null } : {}),
    };
    // A hand-built schedule replaces the annual cost year by year
    // (engine/expenses.ts), so a new cost would be ignored and moved years
    // costed at $0. Drop it then; a name- or accounts-only edit keeps it.
    if (yearsMoved || (initial && initial.annualAmount !== amount)) delete expense.scheduleOverrides;

    const newMutations: SolverMutation[] = [];
    if (emitNew) {
      const { account, rule } = buildQuickAddAccount({
        type: "taxable",
        ownerFamilyMemberId: newOwnerIds[0],
        coOwnerFamilyMemberId: newOwnerIds[1],
        ownerLabel: newOwnerLabel,
        name: newNameValue,
        annualAmount: Number(newAnnual) || 0,
        startYear: currentYear,
        endYear: end,
        growthRate: growthTaxable,
        accountId: newId,
        ruleId: `goal-fund-rule-${newId}`,
        balance: Number(newBalance) || 0,
      });
      newMutations.push({ kind: "account-upsert", id: account.id, value: account });
      if (rule.annualAmount > 0) newMutations.push({ kind: "savings-rule-upsert", id: rule.id, value: rule });
    }
    onSubmit(expense, newMutations);
  }

  return (
    <div className="mt-2 rounded-md border border-hair-2 bg-card-2 p-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 text-[12px] text-ink-3">
          Name
          <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </label>
        <label className="col-span-2 text-[12px] text-ink-3">
          Annual cost
          <input
            aria-label="Annual cost" inputMode="numeric" value={annualAmount}
            onChange={(e) => setAnnualAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            className={inputClass}
          />
        </label>
        <label className="text-[12px] text-ink-3">
          Start year
          <input
            aria-label="Start year" inputMode="numeric" value={startYear}
            onChange={(e) => setStartYear(e.target.value.replace(/[^0-9]/g, ""))}
            className={inputClass}
          />
        </label>
        <label className="text-[12px] text-ink-3">
          Number of years
          <input
            aria-label="Number of years" inputMode="numeric" value={years}
            onChange={(e) => setYears(e.target.value.replace(/[^0-9]/g, ""))}
            className={inputClass}
          />
        </label>

        <div className="col-span-2">
          <DedicatedFundingPicker
            accounts={pickerAccounts}
            value={dedicatedAccountIds}
            onChange={setDedicatedAccountIds}
            goalType="other"
          />
        </div>

        <div className="col-span-2">
          {addingNew ? (
            <div className="rounded border border-hair-2 bg-card p-2">
              <div className="mb-1 flex items-center gap-2">
                <span className="flex-1 text-[12px] font-medium text-ink-2">New savings account</span>
                <button
                  type="button"
                  onClick={() => setDedicatedAccountIds(dedicatedAccountIds.filter((id) => id !== newId))}
                  className="text-[12px] text-ink-3 hover:text-ink"
                >
                  Remove
                </button>
              </div>
              <label className="text-[12px] text-ink-3">
                Account name
                <input
                  aria-label="Account name" value={newNameValue}
                  onChange={(e) => { setNewNameDirty(true); setNewName(e.target.value); }}
                  className={inputClass}
                />
              </label>
              {owners.length > 1 && (
                <label className="mt-1 block text-[12px] text-ink-3">
                  Owner
                  <select
                    aria-label="Owner" value={newOwnerId}
                    onChange={(e) => setNewOwnerId(e.target.value)}
                    className={inputClass}
                  >
                    <option value={JOINT}>Joint</option>
                    {owners.map((o) => (
                      <option key={o.familyMemberId} value={o.familyMemberId}>{o.label}</option>
                    ))}
                  </select>
                </label>
              )}
              <div className="mt-1 grid grid-cols-2 gap-2">
                <label className="text-[12px] text-ink-3">
                  Starting balance
                  <input
                    aria-label="Starting balance" inputMode="numeric" value={newBalance}
                    onChange={(e) => setNewBalance(e.target.value.replace(/[^0-9.]/g, ""))}
                    className={inputClass}
                  />
                </label>
                <label className="text-[12px] text-ink-3">
                  Annual contribution
                  <input
                    aria-label="Annual contribution" inputMode="numeric" value={newAnnual}
                    onChange={(e) => setNewAnnual(e.target.value.replace(/[^0-9.]/g, ""))}
                    className={inputClass}
                  />
                </label>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setDedicatedAccountIds([...dedicatedAccountIds, newId])}
              disabled={owners.length === 0}
              className="rounded-md border border-hair-2 px-3 py-1.5 text-[12px] font-medium text-ink-3 hover:text-ink disabled:opacity-50"
            >
              + New savings account…
            </button>
          )}
        </div>

        {dedicatedAccountIds.length > 0 && (
          <label className="col-span-2 flex items-center gap-2 text-[12px] text-ink-3">
            <input type="checkbox" checked={payOutOfPocket} onChange={(e) => setPayOutOfPocket(e.target.checked)} />
            <span>Pay shortfall out of pocket</span>
          </label>
        )}
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-1 text-[12px] text-ink-3">Cancel</button>
        <button type="button" onClick={submit} className="rounded bg-accent/20 px-3 py-1 text-[12px] font-medium text-ink">
          {mode === "edit" ? "Save goal" : "Add goal"}
        </button>
      </div>
    </div>
  );
}
