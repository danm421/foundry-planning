// src/components/portal/budget-amount-input.tsx
"use client";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { usePortalFetch } from "@/components/portal/portal-mode-context";

/**
 * Always-on budget cell for the portal Budget list. Commits on blur/Enter via
 * PUT /api/portal/budgets (act-as aware), then router.refresh() so the group
 * rollups, donut and totals recompute server-side. Esc reverts; an unchanged
 * value is a no-op; a failed save reverts and flags. Works for both leaf and
 * group category ids (a group id sets the explicit group budget).
 */
export function BudgetAmountInput({
  categoryId,
  value,
  label,
  muted,
}: {
  categoryId: string;
  value: number | null;
  label: string;
  muted?: boolean;
}): ReactElement {
  const router = useRouter();
  const portalFetch = usePortalFetch();
  const seed = value != null ? String(value) : "";
  const [draft, setDraft] = useState<string>(seed);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const lastSaved = useRef<string>(seed);
  const reverting = useRef(false);

  // Re-sync from server data after a router.refresh() changes the prop.
  useEffect(() => {
    const next = value != null ? String(value) : "";
    setDraft(next);
    lastSaved.current = next;
  }, [value]);

  async function commit(): Promise<void> {
    if (reverting.current) {
      reverting.current = false;
      return;
    }
    const trimmed = draft.trim();
    if (trimmed === lastSaved.current) return;
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed != null && !Number.isFinite(parsed)) {
      setDraft(lastSaved.current);
      return;
    }
    setSaving(true);
    setError(false);
    try {
      const res = await portalFetch("/api/portal/budgets", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categoryId, monthlyAmount: parsed }),
      });
      if (!res.ok) {
        setError(true);
        setDraft(lastSaved.current);
        return;
      }
      lastSaved.current = trimmed;
      router.refresh();
    } catch {
      setError(true);
      setDraft(lastSaved.current);
    } finally {
      setSaving(false);
    }
  }

  return (
    <span
      className={`flex w-14 shrink-0 items-center justify-end rounded ${
        error ? "ring-1 ring-crit" : ""
      }`}
    >
      <span aria-hidden className="text-[11px] text-ink-4">
        $
      </span>
      <input
        aria-label={`Budget for ${label}`}
        inputMode="decimal"
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            reverting.current = true;
            setDraft(lastSaved.current);
            e.currentTarget.blur();
          }
        }}
        placeholder="—"
        className={`tabular w-full min-w-0 rounded bg-transparent py-0.5 pr-0.5 text-right text-[12px] outline-none focus:ring-1 focus:ring-accent ${
          muted ? "text-ink-3" : "text-ink-2"
        }`}
      />
    </span>
  );
}
