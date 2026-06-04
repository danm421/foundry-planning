// src/components/quick-start/insurance-step.tsx
"use client";
import { useRef, useState } from "react";
import { CurrencyInput } from "@/components/currency-input";
import { inputClassName, selectClassName } from "@/components/forms/input-styles";
import { insurancePayload } from "@/lib/quick-start/derive";
import type { QsInsuranceDraft, QsPolicyType } from "@/lib/quick-start/types";
import type { QsStepProps } from "./step-props";
import { Labeled, sendJson } from "./ui";

type Row = QsInsuranceDraft & { _id: number };

const POLICY_TYPE_OPTIONS: { value: QsPolicyType; label: string }[] = [
  { value: "term", label: "Term" },
  { value: "whole", label: "Whole" },
  { value: "universal", label: "Universal" },
];

export function InsuranceStep({ ctx, bootstrap, registerSave }: QsStepProps) {
  const idRef = useRef(1);
  const [rows, setRows] = useState<Row[]>([]);

  const update = (id: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r._id === id ? { ...r, ...patch } : r)));
  const remove = (id: number) => setRows((rs) => rs.filter((r) => r._id !== id));
  const add = () =>
    setRows((rs) => [
      ...rs,
      {
        _id: idRef.current++,
        insured: "client",
        policyType: "term",
        faceValue: 0,
        premiumAmount: 0,
      },
    ]);

  registerSave(async () => {
    // Validation: term policies need a term length or endsAtInsuredRetirement
    for (const r of rows) {
      if (r.policyType === "term" && !r.endsAtInsuredRetirement && !r.termLengthYears) {
        throw new Error("Term policies need a term length or 'ends at retirement'.");
      }
    }

    for (const r of rows) {
      const { _id: _drop, ...draft } = r;
      void _drop;
      const ownerFamilyMemberId =
        draft.insured === "spouse"
          ? bootstrap.familyMemberIds.spouse
          : bootstrap.familyMemberIds.client;
      await sendJson(
        `/api/clients/${bootstrap.clientId}/insurance-policies`,
        "POST",
        insurancePayload(draft, ctx, ownerFamilyMemberId),
      );
    }
  });

  return (
    <div className="space-y-4">
      {rows.length === 0 && (
        <p className="text-[13px] text-ink-3">
          No insurance policies yet. Add term, whole, or universal life policies.
        </p>
      )}
      {rows.map((r) => (
        <div
          key={r._id}
          className="space-y-3 rounded-[var(--radius-md)] border border-hair bg-card-2/40 p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <Labeled label="Insured">
              <div role="group" aria-label="Insured" className="flex flex-wrap gap-1.5">
                {(["client", ...(ctx.hasSpouse ? ["spouse"] : [])] as Array<"client" | "spouse">).map(
                  (v) => {
                    const label =
                      v === "client" ? ctx.clientFirstName : (ctx.spouseFirstName ?? "Spouse");
                    return (
                      <button
                        key={v}
                        type="button"
                        aria-pressed={r.insured === v}
                        onClick={() => update(r._id, { insured: v })}
                        className={
                          "rounded-[var(--radius-sm)] border px-3 py-1.5 text-[12px] font-medium transition-colors " +
                          (r.insured === v
                            ? "border-accent bg-accent text-accent-on"
                            : "border-hair bg-card-2 text-ink-3 hover:text-ink")
                        }
                      >
                        {label}
                      </button>
                    );
                  },
                )}
              </div>
            </Labeled>
            <button
              type="button"
              onClick={() => remove(r._id)}
              className="mt-6 text-[12px] text-ink-3 transition-colors hover:text-crit"
            >
              Remove
            </button>
          </div>

          <Labeled label="Policy type">
            <select
              aria-label="Policy type"
              value={r.policyType}
              onChange={(e) => update(r._id, { policyType: e.target.value as QsPolicyType })}
              className={selectClassName}
            >
              {POLICY_TYPE_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Labeled>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Labeled label="Face value">
              <CurrencyInput
                aria-label="Face value"
                value={r.faceValue !== 0 ? r.faceValue : ""}
                onChange={(raw) => update(r._id, { faceValue: raw ? Number(raw) : 0 })}
              />
            </Labeled>
            <Labeled label="Annual premium">
              <CurrencyInput
                aria-label="Annual premium"
                value={r.premiumAmount !== 0 ? r.premiumAmount : ""}
                onChange={(raw) => update(r._id, { premiumAmount: raw ? Number(raw) : 0 })}
              />
            </Labeled>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Labeled label="Premium years">
              <input
                type="number"
                aria-label="Premium years"
                min={1}
                value={r.premiumYears ?? ""}
                onChange={(e) =>
                  update(r._id, {
                    premiumYears: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
                className={inputClassName}
              />
            </Labeled>
            <Labeled label="Ends at retirement">
              <div className="flex h-9 items-center">
                <input
                  type="checkbox"
                  aria-label="Ends at retirement"
                  checked={r.endsAtInsuredRetirement ?? false}
                  onChange={(e) => update(r._id, { endsAtInsuredRetirement: e.target.checked })}
                  className="h-4 w-4 rounded border-hair accent-accent"
                />
              </div>
            </Labeled>
          </div>

          {r.policyType === "term" && (
            <Labeled label="Term length (years)">
              <input
                type="number"
                aria-label="Term length"
                min={1}
                value={r.termLengthYears ?? ""}
                onChange={(e) =>
                  update(r._id, {
                    termLengthYears: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
                className={inputClassName}
              />
            </Labeled>
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        className="rounded-[var(--radius-sm)] border border-dashed border-hair px-4 py-2 text-[13px] font-medium text-ink-2 transition-colors hover:border-accent hover:text-accent"
      >
        + Add policy
      </button>
    </div>
  );
}
