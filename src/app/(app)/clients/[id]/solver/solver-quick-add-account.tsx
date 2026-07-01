"use client";

import { useState } from "react";
import MilestoneYearPicker from "@/components/milestone-year-picker";
import type { ClientMilestones, YearRef } from "@/lib/milestones";
import type { SolverMutation } from "@/lib/solver/types";
import {
  buildQuickAddAccount,
  buildSavingsRuleForAccount,
  defaultAccountName,
  QUICK_ADD_TYPE_MAP,
  type QuickAddType,
} from "@/lib/solver/quick-add-account";

interface OwnerOption {
  familyMemberId: string;
  label: string;
}

export interface ExistingAddableAccount {
  id: string;
  name: string;
  category: string;
  subType: string;
  ownerFamilyMemberId: string;
}

interface Props {
  owners: OwnerOption[];
  /** Accounts (taxable/cash/retirement) with no savings rule yet. */
  existingAccounts: ExistingAddableAccount[];
  currentYear: number;
  /** Retirement year for a given owner (for the default End). */
  retirementYearForOwner: (familyMemberId: string) => number;
  /** CMA-resolved growth rate for the chosen type. */
  growthForType: (type: QuickAddType) => number;
  /** Resolved milestones, for the "Activates" year picker. */
  milestones: ClientMilestones;
  onChange: (m: SolverMutation) => void;
}

const TYPE_ORDER: QuickAddType[] = ["taxable", "ira", "roth_ira", "cash"];
const NEW_ACCOUNT = "__new__";

export function SolverQuickAddAccount({
  owners, existingAccounts, currentYear, retirementYearForOwner, growthForType, milestones, onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const defaultSelection = existingAccounts[0]?.id ?? NEW_ACCOUNT;
  const [selection, setSelection] = useState(defaultSelection);
  const [type, setType] = useState<QuickAddType>("taxable");
  const [ownerId, setOwnerId] = useState(owners[0]?.familyMemberId ?? "");
  const [name, setName] = useState("");
  const [nameDirty, setNameDirty] = useState(false);
  const [amount, setAmount] = useState("");
  const [activationEnabled, setActivationEnabled] = useState(false);
  const [activationYear, setActivationYear] = useState(currentYear);
  const [activationYearRef, setActivationYearRef] = useState<YearRef | null>(null);

  const isNew = selection === NEW_ACCOUNT;
  const selectedExisting = existingAccounts.find((a) => a.id === selection);

  const ownerLabel = owners.find((o) => o.familyMemberId === ownerId)?.label ?? "";
  const composedName = defaultAccountName(ownerLabel, type);
  const nameValue = nameDirty ? name : composedName;

  const endYearOwner = isNew ? ownerId : (selectedExisting?.ownerFamilyMemberId ?? ownerId);
  const endYear = retirementYearForOwner(endYearOwner);

  function reset() {
    setSelection(defaultSelection);
    setType("taxable"); setOwnerId(owners[0]?.familyMemberId ?? "");
    setName(""); setNameDirty(false); setAmount("");
    setActivationEnabled(false); setActivationYear(currentYear); setActivationYearRef(null);
  }

  function submit() {
    const annualAmount = Number(amount) || 0;
    if (isNew) {
      const { account, rule } = buildQuickAddAccount({
        type,
        ownerFamilyMemberId: ownerId,
        ownerLabel,
        name: nameValue,
        annualAmount,
        startYear: currentYear,
        endYear,
        growthRate: growthForType(type),
        accountId: crypto.randomUUID(),
        ruleId: crypto.randomUUID(),
        activationYear: activationEnabled ? activationYear : null,
        activationYearRef: activationEnabled ? activationYearRef : null,
      });
      onChange({ kind: "account-upsert", id: account.id, value: account });
      onChange({ kind: "savings-rule-upsert", id: rule.id, value: rule });
    } else if (selectedExisting) {
      const rule = buildSavingsRuleForAccount({
        account: {
          id: selectedExisting.id,
          category: selectedExisting.category,
          subType: selectedExisting.subType,
        },
        annualAmount,
        startYear: currentYear,
        endYear,
        ruleId: crypto.randomUUID(),
      });
      onChange({ kind: "savings-rule-upsert", id: rule.id, value: rule });
    }
    reset();
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 rounded-md border border-hair-2 px-3 py-1.5 text-[12px] font-medium text-ink-3 hover:text-ink"
      >
        + Add account
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-hair-2 bg-card-2 p-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 text-[12px] text-ink-3">
          Account
          <select
            aria-label="Account"
            value={selection}
            onChange={(e) => setSelection(e.target.value)}
            className="mt-1 w-full rounded border border-hair-2 bg-card px-2 py-1 text-ink"
          >
            {existingAccounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
            <option value={NEW_ACCOUNT}>+ New account…</option>
          </select>
        </label>

        {isNew ? (
          <>
            <label className="text-[12px] text-ink-3">
              Type
              <select
                aria-label="Type"
                value={type}
                onChange={(e) => setType(e.target.value as QuickAddType)}
                className="mt-1 w-full rounded border border-hair-2 bg-card px-2 py-1 text-ink"
              >
                {TYPE_ORDER.map((t) => (
                  <option key={t} value={t}>{QUICK_ADD_TYPE_MAP[t].label}</option>
                ))}
              </select>
            </label>
            <label className="text-[12px] text-ink-3">
              Owner
              <select
                aria-label="Owner"
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                className="mt-1 w-full rounded border border-hair-2 bg-card px-2 py-1 text-ink"
              >
                {owners.map((o) => (
                  <option key={o.familyMemberId} value={o.familyMemberId}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="col-span-2 text-[12px] text-ink-3">
              Name
              <input
                aria-label="Name"
                value={nameValue}
                onChange={(e) => { setNameDirty(true); setName(e.target.value); }}
                className="mt-1 w-full rounded border border-hair-2 bg-card px-2 py-1 text-ink"
              />
            </label>
            <div className="col-span-2">
              <label className="flex items-center gap-2 text-[12px] text-ink-3">
                <input
                  type="checkbox"
                  checked={activationEnabled}
                  onChange={(e) => setActivationEnabled(e.target.checked)}
                />
                <span>Activates in a future year (inheritance, new account)</span>
              </label>
              {activationEnabled && (
                <div className="mt-2 max-w-xs">
                  <MilestoneYearPicker
                    id="quick-add-activationYear"
                    name="activationYear"
                    label="Activates"
                    value={activationYear}
                    yearRef={activationYearRef}
                    milestones={milestones}
                    position="start"
                    minYear={currentYear}
                    onChange={(y, ref) => {
                      setActivationYear(y);
                      setActivationYearRef(ref);
                    }}
                  />
                </div>
              )}
            </div>
          </>
        ) : null}

        <label className="col-span-2 text-[12px] text-ink-3">
          Annual savings
          <input
            aria-label="Annual savings"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            className="mt-1 w-full rounded border border-hair-2 bg-card px-2 py-1 text-ink"
          />
        </label>
      </div>
      <p className="mt-2 text-[11px] text-ink-4">
        Starts {isNew && activationEnabled ? activationYear : currentYear}, ends at retirement ({endYear}).
      </p>
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={() => { reset(); setOpen(false); }} className="px-3 py-1 text-[12px] text-ink-3">
          Cancel
        </button>
        <button type="button" onClick={submit} className="rounded bg-accent/20 px-3 py-1 text-[12px] font-medium text-ink">
          Add
        </button>
      </div>
    </div>
  );
}
