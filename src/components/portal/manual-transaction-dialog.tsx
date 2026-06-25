"use client";
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { CategoryPicker } from "@/components/portal/category-picker";
import { usePortalFetch } from "@/components/portal/portal-mode-context";
import type { PortalTransactionDTO } from "@/components/portal/transactions-list";

type CategoryRow = { id: string; name: string; kind: "group" | "category"; parentId: string | null };
type TxnType = "income" | "expense" | "transfer";
type AccountOption = { id: string; name: string; mask: string | null };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ManualTransactionDialog({
  txn,
  categories,
  onClose,
  onSaved,
}: {
  txn?: PortalTransactionDTO | null;
  categories: CategoryRow[];
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const portalFetch = usePortalFetch();
  const isEdit = !!txn;

  const [date, setDate] = useState(txn?.date ?? today());
  const [amount, setAmount] = useState(txn ? String(Math.abs(Number(txn.amount))) : "");
  const [type, setType] = useState<TxnType>(txn?.type ?? "expense");
  const [name, setName] = useState(txn?.name ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(txn?.categoryId ?? null);
  const [accountId, setAccountId] = useState<string | null>(txn?.accountId ?? null);
  const [accountOptions, setAccountOptions] = useState<AccountOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void portalFetch("/api/portal/accounts")
      .then((r) => (r.ok ? r.json() : { accounts: [] }))
      .then((d: { accounts: AccountOption[] }) => setAccountOptions(d.accounts ?? []))
      .catch(() => setAccountOptions([]));
  }, [portalFetch]);

  async function submit() {
    const mag = Number(amount);
    if (!name.trim()) { setError("Add a description."); return; }
    if (!Number.isFinite(mag) || mag <= 0) { setError("Enter an amount greater than zero."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setError("Pick a valid date."); return; }

    setSubmitting(true);
    setError(null);
    const payload = {
      date,
      amount: mag,
      type,
      name: name.trim(),
      categoryId: type === "transfer" ? null : categoryId,
      accountId,
    };
    try {
      const res = isEdit
        ? await portalFetch(`/api/portal/transactions/${txn!.id}`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await portalFetch("/api/portal/transactions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) { setError("Couldn't save that transaction."); return; }
      onSaved();
    } catch {
      setError("Couldn't save that transaction.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-paper/70 p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-hair bg-card p-5">
        <h2 className="text-[15px] font-semibold text-ink">
          {isEdit ? "Edit transaction" : "New transaction"}
        </h2>

        <div className="flex gap-1 rounded-lg bg-card-2 p-1">
          {(["expense", "income", "transfer"] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setType(opt)}
              className={
                type === opt
                  ? "flex-1 rounded-md bg-accent/20 px-2 py-1 text-[12px] font-medium text-accent"
                  : "flex-1 rounded-md px-2 py-1 text-[12px] text-ink-3 hover:bg-card"
              }
            >
              {opt.charAt(0).toUpperCase() + opt.slice(1)}
            </button>
          ))}
        </div>

        <label className="block space-y-1">
          <span className="text-[12px] text-ink-3">Amount</span>
          <input
            aria-label="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            className="w-full rounded-md border border-hair bg-card-2 px-2 py-1 text-[13px] text-ink"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-[12px] text-ink-3">Date</span>
          <input
            aria-label="Date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-md border border-hair bg-card-2 px-2 py-1 text-[13px] text-ink"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-[12px] text-ink-3">Description</span>
          <input
            aria-label="Description"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-hair bg-card-2 px-2 py-1 text-[13px] text-ink"
          />
        </label>

        {type !== "transfer" && (
          <label className="block space-y-1">
            <span className="text-[12px] text-ink-3">Category</span>
            <CategoryPicker categories={categories} value={categoryId} onPick={setCategoryId} />
          </label>
        )}

        <label className="block space-y-1">
          <span className="text-[12px] text-ink-3">Account (optional)</span>
          <select
            aria-label="Account"
            value={accountId ?? ""}
            onChange={(e) => setAccountId(e.target.value === "" ? null : e.target.value)}
            className="w-full rounded-md border border-hair bg-card-2 px-2 py-1 text-[13px] text-ink-2"
          >
            <option value="">Cash / no account</option>
            {accountOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}{a.mask ? ` ••${a.mask}` : ""}
              </option>
            ))}
          </select>
        </label>

        {error && <p className="text-[12px] text-crit">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="rounded-md border border-hair px-3 py-1.5 text-[13px] text-ink-2 hover:bg-card-2">Cancel</button>
          <button type="button" disabled={submitting} onClick={() => void submit()}
            className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-on disabled:opacity-50">
            {submitting ? "Saving…" : isEdit ? "Save changes" : "Add transaction"}
          </button>
        </div>
      </div>
    </div>
  );
}
