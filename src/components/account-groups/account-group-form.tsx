"use client";

import { useState } from "react";

type LiquidAccount = {
  id: string;
  name: string;
  category: "taxable" | "cash" | "retirement";
  value: number;
};

export type GroupFormInitial = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  memberAccountIds: string[];
};

interface Props {
  clientId: string;
  liquidAccounts: LiquidAccount[];
  initial?: GroupFormInitial;
  onDone: () => void;
  onCancel: () => void;
}

function formatDollars(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

const CATEGORY_LABEL: Record<string, string> = {
  taxable: "Taxable",
  cash: "Cash",
  retirement: "Retirement",
};

export default function AccountGroupForm({
  clientId,
  liquidAccounts,
  initial,
  onDone,
  onCancel,
}: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [color, setColor] = useState(initial?.color ?? "#6366f1");
  const [selected, setSelected] = useState<Set<string>>(
    new Set(initial?.memberAccountIds ?? []),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groupedByCategory = (["taxable", "retirement", "cash"] as const).map((cat) => ({
    cat,
    items: liquidAccounts.filter((a) => a.category === cat),
  }));

  const totalValue = liquidAccounts
    .filter((a) => selected.has(a.id))
    .reduce((s, a) => s + a.value, 0);

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const url = initial
        ? `/api/clients/${clientId}/account-groups/${initial.id}`
        : `/api/clients/${clientId}/account-groups`;
      const method = initial ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          color,
          memberAccountIds: [...selected],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-md border border-gray-800 bg-gray-900/50 p-4"
    >
      <div className="grid grid-cols-2 gap-4">
        <label className="block text-sm">
          <span className="mb-1 block text-gray-300">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
            className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-gray-100"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-gray-300">Color</span>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-8 w-16 rounded border border-gray-700 bg-gray-800"
          />
        </label>
      </div>
      <label className="block text-sm">
        <span className="mb-1 block text-gray-300">Description (optional)</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          rows={2}
          className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-gray-100"
        />
      </label>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-300">
          Accounts
        </h4>
        <div className="max-h-96 space-y-3 overflow-auto rounded border border-gray-800 bg-gray-900/40 p-3">
          {groupedByCategory.map(({ cat, items }) =>
            items.length === 0 ? null : (
              <fieldset key={cat}>
                <legend className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  {CATEGORY_LABEL[cat]}
                </legend>
                <ul className="mt-1 space-y-1">
                  {items.map((a) => (
                    <li key={a.id}>
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={selected.has(a.id)}
                          onChange={() => toggle(a.id)}
                          className="h-4 w-4 accent-accent"
                        />
                        <span className="flex-1 text-gray-100">{a.name}</span>
                        <span className="text-xs text-gray-400">
                          ${formatDollars(a.value)}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            ),
          )}
        </div>
        <p className="mt-2 text-xs text-gray-400">
          {selected.size} {selected.size === 1 ? "account" : "accounts"} selected · $
          {formatDollars(totalValue)}
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded border border-red-700 bg-red-900/40 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded px-3 py-1 text-sm text-gray-300 hover:text-white"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || name.trim().length === 0}
          className="rounded bg-accent px-3 py-1 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {initial ? "Save changes" : "Create group"}
        </button>
      </div>
    </form>
  );
}
