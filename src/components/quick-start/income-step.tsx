// src/components/quick-start/income-step.tsx
"use client";
import { useRef, useState } from "react";
import { CurrencyInput } from "@/components/currency-input";
import { inputClassName, selectClassName } from "@/components/forms/input-styles";
import { incomePayload, ssPatch } from "@/lib/quick-start/derive";
import type { QsIncomeDraft, QsIncomeKind } from "@/lib/quick-start/types";
import type { QsStepProps } from "./step-props";
import { Labeled, OwnerPills, sendJson } from "./ui";

type Row = QsIncomeDraft & { _id: number };

const KIND_OPTIONS: { value: QsIncomeKind; label: string }[] = [
  { value: "salary", label: "Salary" },
  { value: "pension", label: "Pension" },
  { value: "social_security", label: "Social Security" },
  { value: "other", label: "Other income" },
];

const TAX_OPTIONS: { value: NonNullable<Row["taxType"]>; label: string }[] = [
  { value: "earned_income", label: "Earned income" },
  { value: "ordinary_income", label: "Ordinary income" },
  { value: "capital_gains", label: "Capital gains" },
  { value: "tax_exempt", label: "Tax-exempt" },
];

export function IncomeStep({ ctx, bootstrap, registerSave }: QsStepProps) {
  const idRef = useRef(1);
  const [rows, setRows] = useState<Row[]>([]);

  const update = (id: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r._id === id ? { ...r, ...patch } : r)));
  const remove = (id: number) => setRows((rs) => rs.filter((r) => r._id !== id));
  const add = () =>
    setRows((rs) => [...rs, { _id: idRef.current++, kind: "salary", owner: "client" }]);

  registerSave(async () => {
    for (const r of rows) {
      const { _id: _drop, ...draft } = r;
      void _drop;
      if (draft.kind === "social_security") {
        const ownerKey = draft.owner === "spouse" ? "spouse" : "client";
        const stubId = bootstrap.ssStubs[ownerKey];
        if (stubId) {
          await sendJson(
            `/api/clients/${bootstrap.clientId}/incomes/${stubId}`,
            "PUT",
            ssPatch({ monthlyBenefit: draft.monthlyBenefit, claimingAge: draft.claimingAge }),
          );
        } else {
          await sendJson(
            `/api/clients/${bootstrap.clientId}/incomes`,
            "POST",
            incomePayload({ ...draft, owner: ownerKey }, ctx),
          );
        }
      } else {
        await sendJson(
          `/api/clients/${bootstrap.clientId}/incomes`,
          "POST",
          incomePayload(draft, ctx),
        );
      }
    }
  });

  return (
    <div className="space-y-4">
      {rows.length === 0 && (
        <p className="text-[13px] text-ink-3">
          No income yet. Add salary, pension, Social Security, or other income.
        </p>
      )}
      {rows.map((r) => (
        <div
          key={r._id}
          className="space-y-3 rounded-[var(--radius-md)] border border-hair bg-card-2/40 p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <Labeled label="Type">
              <select
                aria-label="Type"
                value={r.kind}
                onChange={(e) => update(r._id, { kind: e.target.value as QsIncomeKind })}
                className={selectClassName}
              >
                {KIND_OPTIONS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </Labeled>
            <button
              type="button"
              onClick={() => remove(r._id)}
              className="mt-6 text-[12px] text-ink-3 transition-colors hover:text-crit"
            >
              Remove
            </button>
          </div>

          <Labeled label="Owner">
            <OwnerPills
              value={r.owner}
              onChange={(o) => update(r._id, { owner: o })}
              clientName={ctx.clientFirstName}
              spouseName={ctx.hasSpouse ? ctx.spouseFirstName : null}
              allowJoint={r.kind !== "social_security"}
            />
          </Labeled>

          {r.kind === "social_security" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Labeled label="Monthly benefit">
                <CurrencyInput
                  aria-label="Monthly benefit"
                  value={r.monthlyBenefit ?? ""}
                  onChange={(raw) =>
                    update(r._id, { monthlyBenefit: raw ? Number(raw) : undefined })
                  }
                />
              </Labeled>
              <Labeled label="Claiming age">
                <input
                  type="number"
                  aria-label="Claiming age"
                  min={62}
                  max={70}
                  value={r.claimingAge ?? ""}
                  onChange={(e) =>
                    update(r._id, {
                      claimingAge: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                  className={inputClassName}
                />
              </Labeled>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Labeled label="Amount">
                <CurrencyInput
                  aria-label="Amount"
                  value={r.amount ?? ""}
                  onChange={(raw) => update(r._id, { amount: raw ? Number(raw) : undefined })}
                />
              </Labeled>
              {(r.kind === "salary" || r.kind === "other") && (
                <Labeled label="Tax treatment">
                  <select
                    aria-label="Tax treatment"
                    value={r.taxType ?? (r.kind === "salary" ? "earned_income" : "ordinary_income")}
                    onChange={(e) => update(r._id, { taxType: e.target.value as Row["taxType"] })}
                    className={selectClassName}
                  >
                    {TAX_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </Labeled>
              )}
            </div>
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        className="rounded-[var(--radius-sm)] border border-dashed border-hair px-4 py-2 text-[13px] font-medium text-ink-2 transition-colors hover:border-accent hover:text-accent"
      >
        + Add income
      </button>
    </div>
  );
}
