// src/components/quick-start/savings-step.tsx
"use client";
import { useState } from "react";
import { CurrencyInput } from "@/components/currency-input";
import { inputClassName, selectClassName } from "@/components/forms/input-styles";
import { savingsPayload } from "@/lib/quick-start/derive";
import type { QsSavingsDraft, QsContribMode, QsMatchMode } from "@/lib/quick-start/types";
import type { QsSavingsStepProps, CreatedAccount } from "./step-props";
import { Labeled, sendJson } from "./ui";

type WorkplaceSubType = "401k" | "403b";
type IraSubType = "traditional_ira" | "roth_ira";

function isWorkplace(subType: string): subType is WorkplaceSubType {
  return subType === "401k" || subType === "403b";
}

function isIra(subType: string): subType is IraSubType {
  return subType === "traditional_ira" || subType === "roth_ira";
}

interface RowState {
  enabled: boolean;
  draft: QsSavingsDraft;
}

function initialDraft(account: CreatedAccount): QsSavingsDraft {
  const base = {
    accountId: account.id,
    accountCategory: account.category as "cash" | "taxable" | "retirement",
    accountSubType: account.subType,
  };
  if (account.category === "cash" || account.category === "taxable") {
    return { ...base, mode: "fixed" };
  }
  // retirement
  if (isWorkplace(account.subType)) {
    return { ...base, mode: "fixed", roth: false, matchMode: "none" };
  }
  // IRA
  return { ...base, mode: "fixed" };
}

function CashTaxableFields({
  draft,
  onChange,
}: {
  draft: QsSavingsDraft;
  onChange: (patch: Partial<QsSavingsDraft>) => void;
}) {
  return (
    <div className="space-y-3">
      <Labeled label="Annual amount">
        <CurrencyInput
          aria-label="Annual amount"
          value={draft.amount ?? ""}
          onChange={(raw) => onChange({ amount: raw ? Number(raw) : undefined })}
        />
      </Labeled>
      <label className="flex items-center gap-2 text-[13px] text-ink-2">
        <input
          type="checkbox"
          aria-label="Grow with inflation"
          checked={draft.growthInflation ?? false}
          onChange={(e) => onChange({ growthInflation: e.target.checked })}
        />
        Grow with inflation
      </label>
    </div>
  );
}

function WorkplaceFields({
  draft,
  onChange,
}: {
  draft: QsSavingsDraft;
  onChange: (patch: Partial<QsSavingsDraft>) => void;
}) {
  const roth = draft.roth ?? false;
  const mode = draft.mode;
  const matchMode = draft.matchMode ?? "none";

  return (
    <div className="space-y-3">
      {/* Pretax / Roth toggle */}
      <Labeled label="Contribution type">
        <div role="group" aria-label="Contribution type" className="flex gap-1.5">
          {(
            [
              { v: false, label: "Pretax" },
              { v: true, label: "Roth" },
            ] as { v: boolean; label: string }[]
          ).map((opt) => (
            <button
              key={String(opt.v)}
              type="button"
              aria-pressed={roth === opt.v}
              onClick={() => onChange({ roth: opt.v })}
              className={
                "rounded-[var(--radius-sm)] border px-3 py-1.5 text-[12px] font-medium transition-colors " +
                (roth === opt.v
                  ? "border-accent bg-accent text-accent-on"
                  : "border-hair bg-card-2 text-ink-3 hover:text-ink")
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      </Labeled>

      {/* Contribution mode */}
      <Labeled label="Contribution mode">
        <select
          aria-label="Contribution mode"
          value={mode}
          onChange={(e) => onChange({ mode: e.target.value as QsContribMode })}
          className={selectClassName}
        >
          <option value="fixed">Fixed $</option>
          <option value="percent">% of salary</option>
          <option value="max">Max</option>
        </select>
      </Labeled>

      {mode === "fixed" && (
        <Labeled label="Annual amount">
          <CurrencyInput
            aria-label="Annual amount"
            value={draft.amount ?? ""}
            onChange={(raw) => onChange({ amount: raw ? Number(raw) : undefined })}
          />
        </Labeled>
      )}

      {mode === "percent" && (
        <Labeled label="Percent of salary">
          <input
            type="number"
            aria-label="Percent of salary"
            min={0}
            max={100}
            step={0.1}
            value={draft.percent !== undefined ? draft.percent * 100 : ""}
            onChange={(e) =>
              onChange({ percent: e.target.value ? Number(e.target.value) / 100 : undefined })
            }
            className={inputClassName}
          />
        </Labeled>
      )}

      {/* Employer match */}
      <Labeled label="Employer match">
        <select
          aria-label="Employer match"
          value={matchMode}
          onChange={(e) => onChange({ matchMode: e.target.value as QsMatchMode })}
          className={selectClassName}
        >
          <option value="none">None</option>
          <option value="percent">Percent</option>
          <option value="fixed">Fixed</option>
        </select>
      </Labeled>

      {matchMode === "percent" && (
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Match percent">
            <input
              type="number"
              aria-label="Match percent"
              min={0}
              max={100}
              step={0.1}
              value={draft.matchPercent !== undefined ? draft.matchPercent * 100 : ""}
              onChange={(e) =>
                onChange({
                  matchPercent: e.target.value ? Number(e.target.value) / 100 : undefined,
                })
              }
              className={inputClassName}
            />
          </Labeled>
          <Labeled label="Match cap">
            <input
              type="number"
              aria-label="Match cap"
              min={0}
              max={100}
              step={0.1}
              value={draft.matchCap !== undefined ? draft.matchCap * 100 : ""}
              onChange={(e) =>
                onChange({
                  matchCap: e.target.value ? Number(e.target.value) / 100 : undefined,
                })
              }
              className={inputClassName}
            />
          </Labeled>
        </div>
      )}

      {matchMode === "fixed" && (
        <Labeled label="Match amount">
          <CurrencyInput
            aria-label="Match amount"
            value={draft.matchAmount ?? ""}
            onChange={(raw) => onChange({ matchAmount: raw ? Number(raw) : undefined })}
          />
        </Labeled>
      )}
    </div>
  );
}

function IraFields({
  draft,
  onChange,
}: {
  draft: QsSavingsDraft;
  onChange: (patch: Partial<QsSavingsDraft>) => void;
}) {
  const mode = draft.mode;

  return (
    <div className="space-y-3">
      <Labeled label="Contribution mode">
        <select
          aria-label="Contribution mode"
          value={mode}
          onChange={(e) => onChange({ mode: e.target.value as QsContribMode })}
          className={selectClassName}
        >
          <option value="fixed">Fixed $</option>
          <option value="max">Max</option>
        </select>
      </Labeled>

      {mode === "fixed" && (
        <Labeled label="Annual amount">
          <CurrencyInput
            aria-label="Annual amount"
            value={draft.amount ?? ""}
            onChange={(raw) => onChange({ amount: raw ? Number(raw) : undefined })}
          />
        </Labeled>
      )}
    </div>
  );
}

export function SavingsStep({ ctx, bootstrap, registerSave, createdAccounts }: QsSavingsStepProps) {
  const eligible = createdAccounts.filter((a) =>
    ["cash", "taxable", "retirement"].includes(a.category),
  );

  const [rows, setRows] = useState<RowState[]>(() =>
    eligible.map((a) => ({ enabled: false, draft: initialDraft(a) })),
  );

  const updateDraft = (idx: number, patch: Partial<QsSavingsDraft>) =>
    setRows((rs) =>
      rs.map((r, i) => (i === idx ? { ...r, draft: { ...r.draft, ...patch } } : r)),
    );

  const toggleEnabled = (idx: number) =>
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, enabled: !r.enabled } : r)));

  registerSave(async () => {
    for (const row of rows) {
      if (!row.enabled) continue;
      await sendJson(
        `/api/clients/${bootstrap.clientId}/savings-rules`,
        "POST",
        savingsPayload(row.draft, ctx),
      );
    }
  });

  if (eligible.length === 0) {
    return (
      <p className="text-[13px] text-ink-3">
        No eligible accounts yet. Add a cash, taxable, or retirement account first.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {eligible.map((account, idx) => {
        const row = rows[idx];
        const enabled = row.enabled;
        const draft = row.draft;

        return (
          <div
            key={account.id}
            className="space-y-3 rounded-[var(--radius-md)] border border-hair bg-card-2/40 p-4"
          >
            <label className="flex items-center gap-2 text-[13px] font-medium text-ink">
              <input
                type="checkbox"
                aria-label={`Enable savings ${account.name}`}
                checked={enabled}
                onChange={() => toggleEnabled(idx)}
              />
              Add savings to {account.name}
            </label>

            {enabled && (
              <>
                {(account.category === "cash" || account.category === "taxable") && (
                  <CashTaxableFields
                    draft={draft}
                    onChange={(patch) => updateDraft(idx, patch)}
                  />
                )}
                {account.category === "retirement" && isWorkplace(account.subType) && (
                  <WorkplaceFields
                    draft={draft}
                    onChange={(patch) => updateDraft(idx, patch)}
                  />
                )}
                {account.category === "retirement" && isIra(account.subType) && (
                  <IraFields
                    draft={draft}
                    onChange={(patch) => updateDraft(idx, patch)}
                  />
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
