// src/components/quick-start/accounts-step.tsx
"use client";
import { useRef, useState } from "react";
import { CurrencyInput } from "@/components/currency-input";
import { selectClassName } from "@/components/forms/input-styles";
import { accountPayload } from "@/lib/quick-start/derive";
import type { QsAccountDraft, QsAccountKind, QsRetirementSubtype } from "@/lib/quick-start/types";
import type { QsAccountsStepProps, CreatedAccount } from "./step-props";
import { Labeled, OwnerPills, sendJson } from "./ui";

type Row = QsAccountDraft & { _id: number };

const KIND_OPTIONS: { value: QsAccountKind; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "taxable", label: "Taxable" },
  { value: "retirement", label: "Retirement" },
  { value: "real_estate", label: "Real estate" },
];

const SUBTYPE_OPTIONS: { value: QsRetirementSubtype; label: string }[] = [
  { value: "traditional_ira", label: "Traditional IRA" },
  { value: "roth_ira", label: "Roth IRA" },
  { value: "401k", label: "401(k)" },
  { value: "403b", label: "403(b)" },
];

export function AccountsStep({
  ctx,
  bootstrap,
  registerSave,
  setCreatedAccounts,
}: QsAccountsStepProps) {
  const idRef = useRef(1);
  const [rows, setRows] = useState<Row[]>([]);

  const update = (id: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r._id === id ? { ...r, ...patch } : r)));
  const remove = (id: number) => setRows((rs) => rs.filter((r) => r._id !== id));
  const add = () =>
    setRows((rs) => [...rs, { _id: idRef.current++, kind: "cash", owner: "client", value: 0 }]);

  registerSave(async () => {
    const created: CreatedAccount[] = [];
    for (const r of rows) {
      const { _id: _drop, ...draft } = r;
      void _drop;
      const result = (await sendJson(
        `/api/clients/${bootstrap.clientId}/accounts`,
        "POST",
        accountPayload(draft, ctx),
      )) as CreatedAccount;
      created.push({
        id: result.id,
        category: result.category,
        subType: result.subType,
        name: result.name,
      });
    }
    setCreatedAccounts(created);
  });

  return (
    <div className="space-y-4">
      {rows.length === 0 && (
        <p className="text-[13px] text-ink-3">
          No accounts yet. Add cash, taxable, retirement, or real estate accounts.
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
                onChange={(e) =>
                  update(r._id, { kind: e.target.value as QsAccountKind, subType: undefined })
                }
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
            />
          </Labeled>

          {r.kind === "retirement" && (
            <Labeled label="Account type">
              <select
                aria-label="Account type"
                value={r.subType ?? "traditional_ira"}
                onChange={(e) => update(r._id, { subType: e.target.value as QsRetirementSubtype })}
                className={selectClassName}
              >
                {SUBTYPE_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Labeled>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Labeled label="Value">
              <CurrencyInput
                aria-label="Value"
                value={r.value !== 0 ? r.value : ""}
                onChange={(raw) => update(r._id, { value: raw ? Number(raw) : 0 })}
              />
            </Labeled>
            {(r.kind === "taxable" || r.kind === "real_estate") && (
              <Labeled label="Cost basis">
                <CurrencyInput
                  aria-label="Cost basis"
                  value={r.basis ?? ""}
                  onChange={(raw) =>
                    update(r._id, { basis: raw ? Number(raw) : undefined })
                  }
                />
              </Labeled>
            )}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        className="rounded-[var(--radius-sm)] border border-dashed border-hair px-4 py-2 text-[13px] font-medium text-ink-2 transition-colors hover:border-accent hover:text-accent"
      >
        + Add account
      </button>
    </div>
  );
}
