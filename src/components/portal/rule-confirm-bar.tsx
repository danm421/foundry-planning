// src/components/portal/rule-confirm-bar.tsx
"use client";
import { useState, type ReactElement } from "react";
import { usePortalFetch } from "@/components/portal/portal-mode-context";

/**
 * Slide-up offered right after someone hand-picks a category: turn that one
 * edit into a standing "contains" rule for the merchant name, applied to every
 * matching transaction. Shown from both the Transactions list and the Budget
 * category panel, so it owns the POST and its own error copy — the host only
 * says what was picked and what to refresh afterwards.
 */
export function RuleConfirmBar({
  pattern,
  categoryId,
  categoryName,
  onDismiss,
  onCreated,
}: {
  pattern: string;
  categoryId: string;
  categoryName: string;
  onDismiss: () => void;
  onCreated: (applied: number) => void;
}): ReactElement {
  const portalFetch = usePortalFetch();
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);

  async function create(): Promise<void> {
    setSubmitting(true);
    setFailed(false);
    try {
      const res = await portalFetch("/api/portal/rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matchType: "contains", pattern, categoryId }),
      });
      if (!res.ok) {
        setFailed(true);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { applied?: number };
      onCreated(data.applied ?? 0);
    } catch {
      setFailed(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="portal-rule-bar fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div className="flex w-full max-w-lg flex-wrap items-center justify-end gap-x-3 gap-y-2 rounded-xl border border-hair bg-card-2 px-4 py-3 shadow-lg">
        <span className="min-w-0 flex-1 text-[13px] text-ink-2">
          Always categorize <span className="font-medium text-ink">{pattern}</span> as{" "}
          <span className="font-medium text-ink">{categoryName}</span>?
        </span>
        {failed && (
          <span className="w-full text-[12px] text-crit">Couldn&apos;t create the rule.</span>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-md px-2 py-1 text-[12px] text-ink-3 hover:bg-card"
        >
          Not now
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => void create()}
          className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-on hover:bg-accent/90 disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create rule"}
        </button>
      </div>
    </div>
  );
}
