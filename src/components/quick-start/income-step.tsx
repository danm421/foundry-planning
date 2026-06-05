// src/components/quick-start/income-step.tsx
"use client";
import { CurrencyInput } from "@/components/currency-input";
import { inputClassName, selectClassName } from "@/components/forms/input-styles";
import { saveIncomeRows, type IncomeRow } from "@/lib/quick-start/income-save";
import type { QsIncomeKind } from "@/lib/quick-start/types";
import type { QsIncomeStepProps } from "./step-props";
import { CollapsibleListEditor, type ListColumn } from "./collapsible-list-editor";
import { Labeled, OwnerPills, sendJson } from "./ui";

// Social Security is pre-seeded as pinned rows, so it is NOT an "Add income" option.
const KIND_OPTIONS: { value: Exclude<QsIncomeKind, "social_security">; label: string }[] = [
  { value: "salary", label: "Salary" },
  { value: "pension", label: "Pension" },
  { value: "other", label: "Other income" },
];

const TAX_OPTIONS: { value: NonNullable<IncomeRow["taxType"]>; label: string }[] = [
  { value: "earned_income", label: "Earned income" },
  { value: "ordinary_income", label: "Ordinary income" },
  { value: "capital_gains", label: "Capital gains" },
  { value: "tax_exempt", label: "Tax-exempt" },
];

const KIND_LABEL: Record<QsIncomeKind, string> = {
  salary: "Salary",
  pension: "Pension",
  social_security: "Social Security",
  other: "Other income",
};

const TAX_LABEL: Record<NonNullable<IncomeRow["taxType"]>, string> = {
  earned_income: "Earned income",
  ordinary_income: "Ordinary income",
  capital_gains: "Capital gains",
  tax_exempt: "Tax-exempt",
};

const COLUMNS: ListColumn[] = [
  { key: "type", label: "Type" },
  { key: "owner", label: "Owner" },
  { key: "amount", label: "Amount", align: "right" },
  { key: "tax", label: "Tax" },
];

const fmtMoney = (n?: number) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;

export function IncomeStep({ ctx, bootstrap, registerSave, list }: QsIncomeStepProps) {
  const { rows, setRows, deletedServerIds, pushDeleted, clearDeleted, makeId } = list;

  const update = (id: number, patch: Partial<IncomeRow>) =>
    setRows((rs) => rs.map((r) => (r._id === id ? { ...r, ...patch } : r)));

  const ownerLabel = (r: IncomeRow) =>
    r.owner === "spouse"
      ? ctx.spouseFirstName ?? "Spouse"
      : r.owner === "joint"
        ? "Joint"
        : ctx.clientFirstName;

  // The chrome's Next button runs this; it reconciles the table to the DB.
  // DELETE sends no body — `sendJson(..., undefined)` stringifies to "undefined",
  // which the DELETE route ignores. (If the route ever rejects it, pass `{}`.)
  registerSave(async () => {
    const result = await saveIncomeRows(rows, deletedServerIds, {
      clientId: bootstrap.clientId,
      ctx,
      post: (body) =>
        sendJson(`/api/clients/${bootstrap.clientId}/incomes`, "POST", body) as Promise<{ id: string }>,
      put: (incomeId, body) =>
        sendJson(`/api/clients/${bootstrap.clientId}/incomes/${incomeId}`, "PUT", body),
      del: (incomeId) =>
        sendJson(`/api/clients/${bootstrap.clientId}/incomes/${incomeId}`, "DELETE", undefined),
    });
    setRows(result.rows);
    clearDeleted();
  });

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-ink-3">
        Social Security is listed for each person — just enter the monthly benefit. Add any
        other income below.
      </p>
      <CollapsibleListEditor<IncomeRow>
        rows={rows}
        columns={COLUMNS}
        isPinned={(r) => r.kind === "social_security"}
        isEmpty={(r) =>
          r.kind === "social_security" ? !r.monthlyBenefit : r.amount == null
        }
        update={update}
        onChange={setRows}
        onRemove={(r) => {
          pushDeleted(r.serverId);
          setRows((rs) => rs.filter((x) => x._id !== r._id));
        }}
        newRow={() => ({ _id: makeId(), kind: "salary", owner: "client" })}
        rowLabel={(r) =>
          r.kind === "social_security"
            ? `Social Security · ${ownerLabel(r)}`
            : `${KIND_LABEL[r.kind]} · ${ownerLabel(r)}`
        }
        addLabel="+ Add income"
        renderSummary={(r) =>
          r.kind === "social_security"
            ? [
                <span key="t">Social Security</span>,
                <span key="o">{ownerLabel(r)}</span>,
                <span key="a">{r.monthlyBenefit ? `${fmtMoney(r.monthlyBenefit)}/mo` : "—/mo"}</span>,
                <span key="x">—</span>,
              ]
            : [
                <span key="t">{KIND_LABEL[r.kind]}</span>,
                <span key="o">{ownerLabel(r)}</span>,
                <span key="a">{fmtMoney(r.amount)}</span>,
                <span key="x">{r.taxType ? TAX_LABEL[r.taxType] : "—"}</span>,
              ]
        }
        renderEditor={(r, upd) =>
          r.kind === "social_security" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Labeled label={`Monthly FRA benefit · ${ownerLabel(r)}`}>
                <CurrencyInput
                  aria-label="Monthly FRA benefit"
                  value={r.monthlyBenefit ?? ""}
                  onChange={(raw) => upd({ monthlyBenefit: raw ? Number(raw) : undefined })}
                />
              </Labeled>
              <Labeled label="Claiming age">
                <input
                  type="number"
                  aria-label="Claiming age"
                  min={62}
                  max={70}
                  value={r.claimingAge ?? ""}
                  placeholder="67"
                  onChange={(e) =>
                    upd({ claimingAge: e.target.value ? Number(e.target.value) : undefined })
                  }
                  className={inputClassName}
                />
              </Labeled>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-start gap-3">
                <Labeled label="Type">
                  <select
                    aria-label="Type"
                    value={r.kind}
                    onChange={(e) => upd({ kind: e.target.value as IncomeRow["kind"] })}
                    className={selectClassName}
                  >
                    {KIND_OPTIONS.map((k) => (
                      <option key={k.value} value={k.value}>{k.label}</option>
                    ))}
                  </select>
                </Labeled>
                <Labeled label="Owner">
                  <OwnerPills
                    value={r.owner}
                    onChange={(o) => upd({ owner: o })}
                    clientName={ctx.clientFirstName}
                    spouseName={ctx.hasSpouse ? ctx.spouseFirstName : null}
                  />
                </Labeled>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Labeled label="Amount">
                  <CurrencyInput
                    aria-label="Amount"
                    value={r.amount ?? ""}
                    onChange={(raw) => upd({ amount: raw ? Number(raw) : undefined })}
                  />
                </Labeled>
                {(r.kind === "salary" || r.kind === "other") && (
                  <Labeled label="Tax treatment">
                    <select
                      aria-label="Tax treatment"
                      value={r.taxType ?? (r.kind === "salary" ? "earned_income" : "ordinary_income")}
                      onChange={(e) => upd({ taxType: e.target.value as IncomeRow["taxType"] })}
                      className={selectClassName}
                    >
                      {TAX_OPTIONS.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </Labeled>
                )}
              </div>
            </div>
          )
        }
      />
    </div>
  );
}
