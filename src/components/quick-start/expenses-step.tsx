// src/components/quick-start/expenses-step.tsx
"use client";
import { useState } from "react";
import { CurrencyInput } from "@/components/currency-input";
import { inputClassName } from "@/components/forms/input-styles";
import { livingExpensePayload } from "@/lib/quick-start/derive";
import { saveLiabilityRows, isEmptyLiability, type LiabilityRow } from "@/lib/quick-start/liability-save";
import { saveOtherExpenseRows, isEmptyOtherExpense, type OtherExpenseRow } from "@/lib/quick-start/other-expense-save";
import type { QsExpensesStepProps } from "./step-props";
import { CollapsibleListEditor, type ListColumn } from "./collapsible-list-editor";
import { Labeled, sendJson, fmtMoney } from "./ui";

const LIABILITY_COLUMNS: ListColumn[] = [
  { key: "name", label: "Name" },
  { key: "balance", label: "Balance", align: "right" },
  { key: "rate", label: "Rate" },
  { key: "term", label: "Term" },
];

const OTHER_EXPENSE_COLUMNS: ListColumn[] = [
  { key: "name", label: "Name" },
  { key: "amount", label: "Amount", align: "right" },
];

export function ExpensesStep({
  ctx,
  bootstrap,
  registerSave,
  liabilityList,
  otherExpenseList,
}: QsExpensesStepProps) {
  const [current, setCurrent] = useState<number | undefined>(undefined);
  const [retirement, setRetirement] = useState<number | undefined>(undefined);

  const missingCurrent = !current;
  const missingRetirement = !retirement;

  registerSave(async () => {
    if (!current || !retirement) {
      throw new Error("Enter both current and retirement annual expenses.");
    }

    const clientId = bootstrap.clientId;
    const { currentId, retirementId } = bootstrap.expenseStubs;

    // Current living expenses
    if (currentId) {
      await sendJson(`/api/clients/${clientId}/expenses/${currentId}`, "PUT", { annualAmount: current });
    } else {
      await sendJson(`/api/clients/${clientId}/expenses`, "POST", livingExpensePayload("current", current, ctx));
    }

    // Retirement living expenses
    if (retirementId) {
      await sendJson(`/api/clients/${clientId}/expenses/${retirementId}`, "PUT", { annualAmount: retirement });
    } else {
      await sendJson(`/api/clients/${clientId}/expenses`, "POST", livingExpensePayload("retirement", retirement, ctx));
    }

    const liab = await saveLiabilityRows(liabilityList.rows, liabilityList.deletedServerIds, {
      ctx,
      post: (b) => sendJson(`/api/clients/${clientId}/liabilities`, "POST", b) as Promise<{ id: string }>,
      put: (lid, b) => sendJson(`/api/clients/${clientId}/liabilities/${lid}`, "PUT", b),
      del: (lid) => sendJson(`/api/clients/${clientId}/liabilities/${lid}`, "DELETE", undefined),
    });
    liabilityList.setRows(liab.rows);
    liabilityList.clearDeleted();

    const other = await saveOtherExpenseRows(otherExpenseList.rows, otherExpenseList.deletedServerIds, {
      ctx,
      post: (b) => sendJson(`/api/clients/${clientId}/expenses`, "POST", b) as Promise<{ id: string }>,
      put: (eid, b) => sendJson(`/api/clients/${clientId}/expenses/${eid}`, "PUT", b),
      del: (eid) => sendJson(`/api/clients/${clientId}/expenses/${eid}`, "DELETE", undefined),
    });
    otherExpenseList.setRows(other.rows);
    otherExpenseList.clearDeleted();
  });

  return (
    <div className="space-y-6">
      {/* Required: current and retirement annual expenses */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Labeled label="Current annual expenses">
            <CurrencyInput
              aria-label="Current annual expenses"
              value={current ?? ""}
              onChange={(raw) => setCurrent(raw ? Number(raw) : undefined)}
            />
          </Labeled>
          {missingCurrent && (
            <p className="mt-1 text-[12px] text-crit">Required</p>
          )}
        </div>
        <div>
          <Labeled label="Retirement annual expenses">
            <CurrencyInput
              aria-label="Retirement annual expenses"
              value={retirement ?? ""}
              onChange={(raw) => setRetirement(raw ? Number(raw) : undefined)}
            />
          </Labeled>
          {missingRetirement && (
            <p className="mt-1 text-[12px] text-crit">Required</p>
          )}
        </div>
      </div>

      {/* Liabilities */}
      <div className="space-y-3">
        <div className="text-[13px] font-medium text-ink-2">Liabilities</div>
        <CollapsibleListEditor<LiabilityRow>
          rows={liabilityList.rows}
          columns={LIABILITY_COLUMNS}
          isEmpty={isEmptyLiability}
          update={(id, patch) =>
            liabilityList.setRows((rs) => rs.map((r) => (r._id === id ? { ...r, ...patch } : r)))
          }
          onChange={liabilityList.setRows}
          onRemove={(r) => {
            liabilityList.pushDeleted(r.serverId);
            liabilityList.setRows((rs) => rs.filter((x) => x._id !== r._id));
          }}
          newRow={() => ({ _id: liabilityList.makeId(), name: "" })}
          rowLabel={(r) => r.name || `Liability ${r._id}`}
          addLabel="+ Add liability"
          renderSummary={(r) => [
            <span key="n">{r.name || "—"}</span>,
            <span key="b">{fmtMoney(r.balance)}</span>,
            <span key="r">{r.interestRatePct != null ? `${r.interestRatePct}%` : "—"}</span>,
            <span key="t">{r.termYears != null ? `${r.termYears}y` : "—"}</span>,
          ]}
          renderEditor={(r, upd) => (
            <div className="space-y-3">
              <Labeled label="Name">
                <input
                  type="text"
                  aria-label="Liability name"
                  value={r.name}
                  onChange={(e) => upd({ name: e.target.value })}
                  className={inputClassName}
                />
              </Labeled>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Labeled label="Balance">
                  <CurrencyInput
                    aria-label="Balance"
                    value={r.balance ?? ""}
                    onChange={(raw) => upd({ balance: raw ? Number(raw) : undefined })}
                  />
                </Labeled>
                <Labeled label="Interest rate (%)">
                  <input
                    type="number"
                    aria-label="Interest rate"
                    min={0}
                    step={0.1}
                    value={r.interestRatePct ?? ""}
                    onChange={(e) =>
                      upd({ interestRatePct: e.target.value ? Number(e.target.value) : undefined })
                    }
                    className={inputClassName}
                  />
                </Labeled>
                <Labeled label="Term (years)">
                  <input
                    type="number"
                    aria-label="Term (years)"
                    min={1}
                    value={r.termYears ?? ""}
                    onChange={(e) =>
                      upd({ termYears: e.target.value ? Number(e.target.value) : undefined })
                    }
                    className={inputClassName}
                  />
                </Labeled>
              </div>
            </div>
          )}
        />
      </div>

      {/* Other expenses */}
      <div className="space-y-3">
        <div className="text-[13px] font-medium text-ink-2">Other expenses</div>
        <CollapsibleListEditor<OtherExpenseRow>
          rows={otherExpenseList.rows}
          columns={OTHER_EXPENSE_COLUMNS}
          isEmpty={isEmptyOtherExpense}
          update={(id, patch) =>
            otherExpenseList.setRows((rs) => rs.map((r) => (r._id === id ? { ...r, ...patch } : r)))
          }
          onChange={otherExpenseList.setRows}
          onRemove={(r) => {
            otherExpenseList.pushDeleted(r.serverId);
            otherExpenseList.setRows((rs) => rs.filter((x) => x._id !== r._id));
          }}
          newRow={() => ({ _id: otherExpenseList.makeId(), name: "" })}
          rowLabel={(r) => r.name || `Expense ${r._id}`}
          addLabel="+ Add expense"
          renderSummary={(r) => [
            <span key="n">{r.name || "—"}</span>,
            <span key="a">{fmtMoney(r.amount)}</span>,
          ]}
          renderEditor={(r, upd) => (
            <div className="space-y-3">
              <Labeled label="Name">
                <input
                  type="text"
                  aria-label="Expense name"
                  value={r.name}
                  onChange={(e) => upd({ name: e.target.value })}
                  className={inputClassName}
                />
              </Labeled>
              <Labeled label="Amount">
                <CurrencyInput
                  aria-label="Expense amount"
                  value={r.amount ?? ""}
                  onChange={(raw) => upd({ amount: raw ? Number(raw) : undefined })}
                />
              </Labeled>
            </div>
          )}
        />
      </div>
    </div>
  );
}
