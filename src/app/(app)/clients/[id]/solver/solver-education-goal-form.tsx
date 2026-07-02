"use client";

import { useState } from "react";
import type { Expense } from "@/engine/types";
import { DedicatedFundingPicker } from "@/components/forms/dedicated-funding-picker";

/** Tuition-inflation default; advisor refines on the full Income & Expenses page. */
const EDUCATION_DEFAULT_GROWTH = 0.05;

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
  currentYear: number;
  onSubmit: (expense: Expense) => void;
  onCancel: () => void;
}

export function SolverEducationGoalForm({ mode, initial, accounts, currentYear, onSubmit, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [annualAmount, setAnnualAmount] = useState(String(initial?.annualAmount ?? ""));
  const [startYear, setStartYear] = useState(String(initial?.startYear ?? currentYear + 1));
  const [years, setYears] = useState(
    String(initial ? Math.max(1, initial.endYear - initial.startYear + 1) : 4),
  );
  const [dedicatedAccountIds, setDedicatedAccountIds] = useState<string[]>(initial?.dedicatedAccountIds ?? []);
  const [payOutOfPocket, setPayOutOfPocket] = useState(initial?.payShortfallOutOfPocket ?? false);

  function submit() {
    const start = Number(startYear) || currentYear + 1;
    const yrs = Math.max(1, Number(years) || 1);
    const expense: Expense = {
      id: initial?.id ?? crypto.randomUUID(),
      type: "education",
      name: name.trim() || "Education Goal",
      annualAmount: Number(annualAmount) || 0,
      startYear: start,
      endYear: start + yrs - 1,
      growthRate: initial?.growthRate ?? EDUCATION_DEFAULT_GROWTH,
      dedicatedAccountIds,
      payShortfallOutOfPocket: payOutOfPocket,
      institutionState: null,
      institutionName: null,
      forFamilyMemberId: initial?.forFamilyMemberId ?? null,
    };
    onSubmit(expense);
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
            accounts={accounts}
            value={dedicatedAccountIds}
            onChange={setDedicatedAccountIds}
          />
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
