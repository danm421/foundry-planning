"use client";

import { useState } from "react";
import type { Expense } from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";
import { DedicatedFundingPicker } from "@/components/forms/dedicated-funding-picker";
import { buildQuickAdd529 } from "@/lib/solver/quick-add-account";

/** Tuition-inflation default; advisor refines on the full Income & Expenses page. */
const EDUCATION_DEFAULT_GROWTH = 0.05;
/** Fallback 529 investment growth when the workspace doesn't inject the resolved
 *  CMA rate (e.g. isolated component tests). */
const DEFAULT_529_GROWTH = 0.05;

export interface EducationGoalFormAccount {
  id: string;
  name: string;
  category: string;
  subType: string;
  ownerFamilyMemberIds?: string[];
}

interface Props {
  mode: "add" | "edit";
  initial?: Expense;
  accounts: EducationGoalFormAccount[];
  /** Household family members the goal can be "for" (and the new 529's beneficiary). */
  beneficiaries?: { familyMemberId: string; label: string }[];
  /** CMA-resolved growth for a new 529 (follows the retirement category). */
  growth529?: number;
  currentYear: number;
  onSubmit: (expense: Expense, newMutations: SolverMutation[]) => void;
  onCancel: () => void;
}

export function SolverEducationGoalForm({
  mode, initial, accounts, beneficiaries = [], growth529 = DEFAULT_529_GROWTH, currentYear, onSubmit, onCancel,
}: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [annualAmount, setAnnualAmount] = useState(String(initial?.annualAmount ?? ""));
  const [startYear, setStartYear] = useState(String(initial?.startYear ?? currentYear + 1));
  const [years, setYears] = useState(
    String(initial ? Math.max(1, initial.endYear - initial.startYear + 1) : 4),
  );
  const [dedicatedAccountIds, setDedicatedAccountIds] = useState<string[]>(initial?.dedicatedAccountIds ?? []);
  const [payOutOfPocket, setPayOutOfPocket] = useState(initial?.payShortfallOutOfPocket ?? false);
  const [forFamilyMemberId, setForFamilyMemberId] = useState(initial?.forFamilyMemberId ?? "");

  // Pending new-529 state. A stable id lets the synthetic account appear (checked)
  // in the funding picker before it's built on submit.
  const [new529Id] = useState(() => crypto.randomUUID());
  const [adding529, setAdding529] = useState(false);
  const [new529Balance, setNew529Balance] = useState("");
  const [new529Annual, setNew529Annual] = useState("");
  const [new529Name, setNew529Name] = useState("");
  const [new529NameDirty, setNew529NameDirty] = useState(false);

  const forLabel = beneficiaries.find((b) => b.familyMemberId === forFamilyMemberId)?.label ?? "";
  const composed529Name = forLabel ? `${forLabel} — 529 Plan` : "529 Plan";
  const new529NameValue = new529NameDirty ? new529Name : composed529Name;

  // Show the pending 529 as a checked row in the funding picker (draw order).
  const pickerAccounts: EducationGoalFormAccount[] = adding529
    ? [
        ...accounts,
        {
          id: new529Id,
          name: `${new529NameValue} (new)`,
          category: "education_savings",
          subType: "529",
          ownerFamilyMemberIds: forFamilyMemberId ? [forFamilyMemberId] : [],
        },
      ]
    : accounts;

  function openNew529() {
    setAdding529(true);
    if (!dedicatedAccountIds.includes(new529Id)) setDedicatedAccountIds([...dedicatedAccountIds, new529Id]);
  }
  function discardNew529() {
    setAdding529(false);
    setDedicatedAccountIds(dedicatedAccountIds.filter((id) => id !== new529Id));
  }

  function submit() {
    const start = Number(startYear) || currentYear + 1;
    const yrs = Math.max(1, Number(years) || 1);
    const end = start + yrs - 1;
    const has529 = adding529 && dedicatedAccountIds.includes(new529Id) && !!forFamilyMemberId;

    // When the pending 529 is NOT being emitted (e.g. the "For" person was
    // cleared, or the row unchecked, after opening the sub-form), strip its
    // synthetic id so the goal never carries a dedicated-funding reference to
    // an account that was never created.
    const finalDedicatedAccountIds = has529
      ? dedicatedAccountIds
      : dedicatedAccountIds.filter((id) => id !== new529Id);

    const expense: Expense = {
      id: initial?.id ?? crypto.randomUUID(),
      type: "education",
      name: name.trim() || "Education Goal",
      annualAmount: Number(annualAmount) || 0,
      startYear: start,
      endYear: end,
      growthRate: initial?.growthRate ?? EDUCATION_DEFAULT_GROWTH,
      dedicatedAccountIds: finalDedicatedAccountIds,
      payShortfallOutOfPocket: payOutOfPocket,
      institutionState: null,
      institutionName: null,
      forFamilyMemberId: forFamilyMemberId || null,
    };

    const newMutations: SolverMutation[] = [];
    if (has529) {
      const { account, rule } = buildQuickAdd529({
        accountId: new529Id,
        ruleId: `edu-529-rule-${new529Id}`,
        name: new529NameValue,
        beneficiaryFamilyMemberId: forFamilyMemberId,
        balance: Number(new529Balance) || 0,
        annualAmount: Number(new529Annual) || 0,
        growthRate: growth529,
        startYear: currentYear,
        endYear: end,
      });
      newMutations.push({ kind: "account-upsert", id: account.id, value: account });
      if (rule) newMutations.push({ kind: "savings-rule-upsert", id: rule.id, value: rule });
    }
    onSubmit(expense, newMutations);
  }

  return (
    <div className="mt-2 rounded-md border border-hair-2 bg-card-2 p-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 text-[12px] text-ink-3">
          Name
          <input
            aria-label="Name" value={name} onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded border border-hair-2 bg-card px-2 py-1 text-ink"
          />
        </label>
        <label className="col-span-2 text-[12px] text-ink-3">
          For
          <select
            aria-label="For" value={forFamilyMemberId}
            onChange={(e) => setForFamilyMemberId(e.target.value)}
            className="mt-1 w-full rounded border border-hair-2 bg-card px-2 py-1 text-ink"
          >
            <option value="">— none —</option>
            {beneficiaries.map((b) => (
              <option key={b.familyMemberId} value={b.familyMemberId}>{b.label}</option>
            ))}
          </select>
        </label>
        <label className="text-[12px] text-ink-3">
          Annual cost
          <input
            aria-label="Annual cost" inputMode="numeric" value={annualAmount}
            onChange={(e) => setAnnualAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            className="mt-1 w-full rounded border border-hair-2 bg-card px-2 py-1 text-ink"
          />
        </label>
        <label className="text-[12px] text-ink-3">
          Start year
          <input
            aria-label="Start year" inputMode="numeric" value={startYear}
            onChange={(e) => setStartYear(e.target.value.replace(/[^0-9]/g, ""))}
            className="mt-1 w-full rounded border border-hair-2 bg-card px-2 py-1 text-ink"
          />
        </label>
        <label className="text-[12px] text-ink-3">
          Number of years
          <input
            aria-label="Number of years" inputMode="numeric" value={years}
            onChange={(e) => setYears(e.target.value.replace(/[^0-9]/g, ""))}
            className="mt-1 w-full rounded border border-hair-2 bg-card px-2 py-1 text-ink"
          />
        </label>
        <div className="col-span-2">
          <DedicatedFundingPicker
            accounts={pickerAccounts}
            value={dedicatedAccountIds}
            onChange={setDedicatedAccountIds}
          />
        </div>

        <div className="col-span-2">
          {adding529 ? (
            <div className="rounded border border-hair-2 bg-card p-2">
              <div className="mb-1 flex items-center gap-2">
                <span className="flex-1 text-[12px] font-medium text-ink-2">New 529 plan</span>
                <button type="button" onClick={discardNew529} className="text-[12px] text-ink-3 hover:text-ink">
                  Remove
                </button>
              </div>
              <label className="text-[12px] text-ink-3">
                Name
                <input
                  aria-label="529 name" value={new529NameValue}
                  onChange={(e) => { setNew529NameDirty(true); setNew529Name(e.target.value); }}
                  className="mt-1 w-full rounded border border-hair-2 bg-card-2 px-2 py-1 text-ink"
                />
              </label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <label className="text-[12px] text-ink-3">
                  Starting balance
                  <input
                    aria-label="Starting balance" inputMode="numeric" value={new529Balance}
                    onChange={(e) => setNew529Balance(e.target.value.replace(/[^0-9.]/g, ""))}
                    className="mt-1 w-full rounded border border-hair-2 bg-card-2 px-2 py-1 text-ink"
                  />
                </label>
                <label className="text-[12px] text-ink-3">
                  Annual contribution
                  <input
                    aria-label="Annual contribution" inputMode="numeric" value={new529Annual}
                    onChange={(e) => setNew529Annual(e.target.value.replace(/[^0-9.]/g, ""))}
                    className="mt-1 w-full rounded border border-hair-2 bg-card-2 px-2 py-1 text-ink"
                  />
                </label>
              </div>
              <p className="mt-1 text-[11px] text-ink-4">Beneficiary: {forLabel || "—"}</p>
            </div>
          ) : (
            <div>
              <button
                type="button" onClick={openNew529} disabled={!forFamilyMemberId}
                className="rounded-md border border-hair-2 px-3 py-1.5 text-[12px] font-medium text-ink-3 hover:text-ink disabled:opacity-50"
              >
                + New 529 plan…
              </button>
              {!forFamilyMemberId && (
                <span className="ml-2 text-[11px] text-ink-4">Pick who this is for first.</span>
              )}
            </div>
          )}
        </div>

        <label className="col-span-2 flex items-center gap-2 text-[12px] text-ink-3">
          <input type="checkbox" checked={payOutOfPocket} onChange={(e) => setPayOutOfPocket(e.target.checked)} />
          <span>Pay shortfall out of pocket</span>
        </label>
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
