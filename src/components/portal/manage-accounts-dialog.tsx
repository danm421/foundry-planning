"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { usePortalFetch } from "./portal-mode-context";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { PlaidLinkButton } from "./plaid-link-button";
import {
  PlaidAccountDecisionRow,
  buildDecision,
  defaultTypeKey,
  type Decision,
  type LinkCandidate,
  type LiabilityCandidate,
  type PlaidAvailableAccount,
  type RowState,
} from "./plaid-account-decision-row";

type LinkedRow = {
  id: string;
  kind: "account" | "liability";
  name: string;
  value: number;
  plaidAccountId: string;
  mask: string | null;
};

type ListPayload = {
  itemId: string;
  institutionName: string | null;
  linked: LinkedRow[];
  available: PlaidAvailableAccount[];
  existingCandidates: LinkCandidate[];
  existingLiabilityCandidates: LiabilityCandidate[];
  needsReauth: boolean;
};

const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function ManageAccountsDialog({
  itemId,
  institutionName,
  editEnabled,
  onClose,
}: {
  itemId: string;
  institutionName: string;
  editEnabled: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const portalFetch = usePortalFetch();
  const [data, setData] = useState<ListPayload | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [pending, setPending] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useBodyScrollLock(true);

  // Escape closes the dialog. Mirrors plaid-account-picker.tsx behaviour.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  const load = useCallback(async () => {
    const r = await portalFetch(`/api/portal/plaid/items/${itemId}/accounts`);
    const json = (await r.json().catch(() => null)) as ListPayload | null;
    if (!r.ok || !json) {
      alert("Couldn't load accounts. Try again.");
      return;
    }
    setData(json);
    const next: Record<string, RowState> = {};
    for (const a of json.available) {
      next[a.plaidAccountId] = {
        mode: "create",
        typeKey: defaultTypeKey(a.type, a.subtype),
        existingId: null,
        skipped: false,
      };
    }
    setRows(next);
  }, [itemId, portalFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = useCallback((id: string, patch: Partial<RowState>) => {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  const detach = (plaidAccountId: string) => {
    if (!window.confirm("Detach this account? It becomes a manually-maintained account.")) return;
    setPending(true);
    void (async () => {
      const r = await portalFetch(
        `/api/portal/plaid/items/${itemId}/accounts/${plaidAccountId}`,
        { method: "DELETE" },
      );
      setPending(false);
      if (!r.ok) {
        alert("Detach failed. Try again.");
        return;
      }
      await load();
      router.refresh();
    })();
  };

  const addSelected = () => {
    if (!data) return;
    const decisions: Decision[] = data.available
      .map((a) =>
        buildDecision(
          a,
          rows[a.plaidAccountId] ?? {
            mode: "create",
            typeKey: defaultTypeKey(a.type, a.subtype),
            existingId: null,
            skipped: false,
          },
        ),
      )
      .filter((d) => d.action !== "skip");
    if (decisions.length === 0) return;
    setPending(true);
    void (async () => {
      const r = await portalFetch("/api/portal/plaid/exchange/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, decisions }),
      });
      setPending(false);
      if (!r.ok) {
        alert("Couldn't add accounts. Try again.");
        return;
      }
      await load();
      router.refresh();
    })();
  };

  const overlay = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-lg border border-border bg-surface p-5 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-ink">Manage {institutionName} accounts</h2>
          <button type="button" onClick={onClose} className="text-ink-subtle hover:text-ink" aria-label="Close">
            ✕
          </button>
        </div>

        {!data ? (
          <p className="text-[13px] text-ink-subtle">Loading…</p>
        ) : data.needsReauth ? (
          <div className="space-y-3">
            <p className="text-[13px] text-amber-600">
              This institution needs to be reconnected before you can manage its accounts.
            </p>
            <PlaidLinkButton mode="reauth" itemId={itemId} />
          </div>
        ) : (
          <div className="space-y-5">
            <section>
              <h3 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-ink-subtle">
                Linked (in your plan)
              </h3>
              {data.linked.length === 0 ? (
                <p className="text-[13px] text-ink-subtle">No linked accounts yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.linked.map((l) => (
                    <li key={l.plaidAccountId} className="flex items-center justify-between gap-3 text-[13px]">
                      <span className="text-ink">
                        {l.name}
                        {l.mask ? ` ••${l.mask}` : ""} · {fmt(l.value)}
                      </span>
                      {editEnabled && (
                        <button
                          type="button"
                          onClick={() => detach(l.plaidAccountId)}
                          disabled={pending}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] font-medium text-red-600 shadow-xs hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Unlink
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-ink-subtle">
                Available to add
              </h3>
              {data.available.length === 0 ? (
                <p className="text-[13px] text-ink-subtle">No additional accounts available.</p>
              ) : (
                <div className="space-y-2">
                  <ul className="space-y-2">
                    {data.available.map((a) => (
                      <PlaidAccountDecisionRow
                        key={a.plaidAccountId}
                        account={a}
                        state={
                          rows[a.plaidAccountId] ?? {
                            mode: "create",
                            typeKey: defaultTypeKey(a.type, a.subtype),
                            existingId: null,
                            skipped: false,
                          }
                        }
                        onChange={(patch) => update(a.plaidAccountId, patch)}
                        existingCandidates={data.existingCandidates}
                        existingLiabilityCandidates={data.existingLiabilityCandidates}
                      />
                    ))}
                  </ul>
                  {editEnabled && (
                    <button
                      type="button"
                      onClick={addSelected}
                      disabled={pending}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] font-medium text-ink shadow-xs hover:bg-surface-raised disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Add selected
                    </button>
                  )}
                </div>
              )}
            </section>

            {editEnabled && (
              <section className="border-t border-border pt-4">
                <PlaidLinkButton
                  mode="account-selection"
                  itemId={itemId}
                  onSelectionComplete={() => void load()}
                />
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(overlay, document.body);
}
