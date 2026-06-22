"use client";
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { CategoryPicker } from "@/components/portal/category-picker";

type CategoryRow = { id: string; name: string; kind: "group" | "category"; parentId: string | null };

export function RuleCreateDialog({
  seed,
  categories,
  onClose,
  onCreated,
}: {
  seed: { merchantName: string | null; name: string; categoryId: string | null };
  categories: CategoryRow[];
  onClose: () => void;
  onCreated: (applied: number) => void;
}): ReactElement {
  const [matchType, setMatchType] = useState<"contains" | "exact">("contains");
  const [pattern, setPattern] = useState(seed.merchantName ?? seed.name);
  const [categoryId, setCategoryId] = useState<string | null>(seed.categoryId);
  const [count, setCount] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pattern.trim()) { setCount(null); return; }
    const handle = setTimeout(() => {
      const p = new URLSearchParams({ matchType, pattern: pattern.trim() });
      void fetch(`/api/portal/rules/preview?${p.toString()}`)
        .then((r) => (r.ok ? r.json() : { count: null }))
        .then((d: { count: number | null }) => setCount(d.count))
        .catch(() => setCount(null));
    }, 300);
    return () => clearTimeout(handle);
  }, [matchType, pattern]);

  async function submit() {
    if (!categoryId || !pattern.trim()) { setError("Pick a category and a pattern."); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matchType, pattern: pattern.trim(), categoryId }),
      });
      if (!res.ok) { setError("Couldn't create the rule."); return; }
      const data = (await res.json()) as { applied: number };
      onCreated(data.applied);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-paper/70 p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-hair bg-card p-5">
        <h2 className="text-[15px] font-semibold text-ink">Create a category rule</h2>
        <label className="block space-y-1">
          <span className="text-[12px] text-ink-3">Match type</span>
          <select
            value={matchType}
            onChange={(e) => setMatchType(e.target.value as "contains" | "exact")}
            className="w-full rounded-md border border-hair bg-card-2 px-2 py-1 text-[13px] text-ink-2"
          >
            <option value="contains">Name contains</option>
            <option value="exact">Name is exactly</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-[12px] text-ink-3">Pattern</span>
          <input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            className="w-full rounded-md border border-hair bg-card-2 px-2 py-1 text-[13px] text-ink"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[12px] text-ink-3">Category</span>
          <CategoryPicker categories={categories} value={categoryId} onPick={setCategoryId} />
        </label>
        {count !== null && (
          <p className="tabular text-[12px] text-ink-3">Will apply to {count} transactions.</p>
        )}
        {error && <p className="text-[12px] text-crit">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-hair px-3 py-1.5 text-[13px] text-ink-2 hover:bg-card-2">Cancel</button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void submit()}
            className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-on disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Create rule"}
          </button>
        </div>
      </div>
    </div>
  );
}
