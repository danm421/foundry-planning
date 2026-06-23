"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LinkSuccessPayload } from "./plaid-link-button";
import { usePortalFetch } from "@/components/portal/portal-mode-context";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { mapPlaidToFoundry, mapPlaidToLiability } from "@/lib/plaid/account-mapping";
import {
  RowState,
  Decision,
  defaultTypeKey,
  buildDecision,
  PlaidAccountDecisionRow,
} from "./plaid-account-decision-row";

export function PlaidAccountPicker({
  payload,
  onClose,
}: {
  payload: LinkSuccessPayload;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const portalFetch = usePortalFetch();
  useBodyScrollLock(true);

  // Per-Plaid-account derived facts: detected kind, sorted link candidates.
  const meta = useMemo(() => {
    const m = new Map<
      string,
      {
        isDebt: boolean;
        preferredCategory: string | null;
        candidates: typeof payload.existingCandidates;
      }
    >();
    for (const a of payload.accounts) {
      const isDebt = mapPlaidToLiability(a.type, a.subtype) != null;
      const preferredCategory = mapPlaidToFoundry(a.type, a.subtype)?.category ?? null;
      // Matching-category candidates first, then alphabetical.
      const candidates = [...payload.existingCandidates].sort((x, y) => {
        const xMatch = x.category === preferredCategory ? 0 : 1;
        const yMatch = y.category === preferredCategory ? 0 : 1;
        if (xMatch !== yMatch) return xMatch - yMatch;
        return x.name.localeCompare(y.name);
      });
      m.set(a.plaidAccountId, { isDebt, preferredCategory, candidates });
    }
    return m;
  }, [payload]);

  const [rows, setRows] = useState<Record<string, RowState>>(() => {
    const initial: Record<string, RowState> = {};
    for (const a of payload.accounts) {
      initial[a.plaidAccountId] = {
        mode: "create",
        typeKey: defaultTypeKey(a.type, a.subtype),
        existingId: null,
        skipped: false,
      };
    }
    return initial;
  });

  const update = useCallback((id: string, patch: Partial<RowState>) => {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  // Esc closes the dialog (matches Cancel). Disabled while a commit is in flight.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  const activeCount = payload.accounts.filter((a) => !rows[a.plaidAccountId].skipped).length;

  const submit = () => {
    const decisions: Decision[] = payload.accounts.map((a) =>
      buildDecision(a, rows[a.plaidAccountId]),
    );

    startTransition(async () => {
      const res = await portalFetch("/api/portal/plaid/exchange/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: payload.itemId, decisions }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        alert((json as { error?: string }).error ?? "Could not link accounts. Try again.");
        return;
      }
      onClose();
      router.refresh();
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-paper/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="plaid-picker-title"
    >
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-hair bg-card shadow-xl">
        <header className="border-b border-hair px-5 py-4">
          <h2 id="plaid-picker-title" className="text-[15px] font-semibold text-ink">
            Link your accounts
          </h2>
          <p className="mt-0.5 text-[12px] text-ink-3">
            Choose how to bring each account into your plan.
          </p>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-1">
          <ul className="divide-y divide-hair">
            {payload.accounts.map((a) => {
              const { candidates } = meta.get(a.plaidAccountId)!;
              return (
                <PlaidAccountDecisionRow
                  key={a.plaidAccountId}
                  account={a}
                  state={rows[a.plaidAccountId]}
                  onChange={(patch) => update(a.plaidAccountId, patch)}
                  existingCandidates={candidates}
                  existingLiabilityCandidates={payload.existingLiabilityCandidates}
                />
              );
            })}
          </ul>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-hair px-5 py-3">
          <span className="text-[12px] text-ink-3">
            {activeCount} of {payload.accounts.length} selected
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="rounded-md border border-hair px-3 py-1.5 text-[13px] text-ink-2 hover:bg-card-2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending || activeCount === 0}
              className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-on disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
