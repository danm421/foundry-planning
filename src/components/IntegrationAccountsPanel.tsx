"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DialogShell from "@/components/dialog-shell";
import { useToast } from "@/components/toast";
import { selectBaseClassName } from "@/components/forms/input-styles";
import { CATEGORY_OPTIONS, SUB_TYPE_OPTIONS } from "@/lib/accounts/category-labels";
import { rankAccountCandidates } from "@/lib/imports/rank-account-candidates";
import { CO_CLIENT_LABEL } from "@/lib/owner-labels";
import type { AccountCategory, AccountSubType } from "@/lib/extraction/types";
import type { HouseholdAccountsPanel, PanelAccountRow } from "@/lib/integrations/household-accounts";
import type { SyncingProviderId } from "@/lib/integrations/types";

interface Props {
  providerId: SyncingProviderId;
  connectionId: string;
  linkId: string;
  open: boolean;
  onClose: () => void;
}

/** `pulledAt` arrives as an ISO string over JSON. */
type PanelData = Omit<HouseholdAccountsPanel, "pulledAt"> & { pulledAt: string | null };

type Draft =
  | { kind: "connect"; planAccountId: string }
  | { kind: "add"; subType: AccountSubType; owner: "client" | "spouse" | "joint" };

const FAILED = "Couldn't update that account. Please try again.";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const SUB_TYPE_CATEGORY: Partial<Record<AccountSubType, AccountCategory>> = {
  brokerage: "taxable",
  trust: "taxable",
  savings: "cash",
  checking: "cash",
  traditional_ira: "retirement",
  roth_ira: "retirement",
  "401k": "retirement",
  "403b": "retirement",
  "529": "education_savings",
  primary_residence: "real_estate",
  rental_property: "real_estate",
  commercial_property: "real_estate",
  sole_proprietorship: "business",
  partnership: "business",
  s_corp: "business",
  c_corp: "business",
  llc: "business",
  term: "life_insurance",
  whole_life: "life_insurance",
  universal_life: "life_insurance",
  variable_life: "life_insurance",
};

/** The category a sub-type belongs to; "Other" keeps the provider's guess when the plan offers it. */
function categoryFor(subType: AccountSubType, guessed: AccountCategory): AccountCategory {
  const known = SUB_TYPE_CATEGORY[subType];
  if (known) return known;
  return CATEGORY_OPTIONS.some((o) => o.value === guessed) ? guessed : "taxable";
}

function formatPulledAt(iso: string | null): string {
  if (!iso) return "Not synced yet";
  const d = new Date(iso);
  return `Values from last sync · ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

export function IntegrationAccountsPanel({ providerId, connectionId, linkId, open, onClose }: Props) {
  const url = `/api/integrations/${providerId}/connections/${connectionId}/households/${linkId}/accounts`;
  const { showToast } = useToast();
  const [panel, setPanel] = useState<PanelData | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  // One account at a time is being connected or added.
  const [editing, setEditing] = useState<{ externalId: string; draft: Draft } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("load failed");
        const json = (await res.json()) as PanelData;
        if (!cancelled) setPanel(json);
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, url]);

  const act = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          setPanel((await res.json()) as PanelData);
          setEditing(null);
          return;
        }
        let message = FAILED;
        if (res.status === 409) {
          const j = (await res.json().catch(() => null)) as { error?: string } | null;
          if (j?.error) message = j.error;
        }
        showToast({ message });
      } catch {
        showToast({ message: FAILED });
      } finally {
        setBusy(false);
      }
    },
    [url, showToast],
  );

  return (
    <DialogShell open={open} onOpenChange={(o) => !o && onClose()} title={panel?.householdName ?? "Accounts"} size="lg">
      {loadFailed ? (
        <p className="text-sm text-ink-3">Couldn&apos;t load these accounts</p>
      ) : !panel ? (
        <p className="text-sm text-ink-3">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-3">{formatPulledAt(panel.pulledAt)}</p>
          <div className="overflow-hidden rounded border border-hair">
            <table className="w-full text-sm">
              <thead className="bg-card text-left text-xs uppercase tracking-wide text-ink-3">
                <tr>
                  <th className="px-3 py-2 font-medium">Account</th>
                  <th className="px-3 py-2 text-right font-medium">Value</th>
                  <th className="px-3 py-2 font-medium">In the plan</th>
                </tr>
              </thead>
              <tbody>
                {panel.rows.map((row) => (
                  <AccountRowView
                    key={row.externalId}
                    row={row}
                    panel={panel}
                    busy={busy}
                    draft={editing?.externalId === row.externalId ? editing.draft : null}
                    setDraft={(draft) => setEditing(draft ? { externalId: row.externalId, draft } : null)}
                    act={act}
                  />
                ))}
                {panel.rows.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-ink-3">
                      No accounts in the last sync.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </DialogShell>
  );
}

function AccountRowView({
  row,
  panel,
  busy,
  draft,
  setDraft,
  act,
}: {
  row: PanelAccountRow;
  panel: PanelData;
  busy: boolean;
  draft: Draft | null;
  setDraft: (d: Draft | null) => void;
  act: (body: Record<string, unknown>) => Promise<void>;
}) {
  const ranked = useMemo(
    () =>
      rankAccountCandidates(
        { name: row.name, category: row.guessedCategory, value: row.value ?? 0 },
        panel.candidates,
      ),
    [row, panel.candidates],
  );

  return (
    <tr className="border-t border-hair align-top">
      <td className="px-3 py-2 text-ink">{row.name}</td>
      <td className="tabular px-3 py-2 text-right text-ink">{row.value === null ? "—" : usd.format(row.value)}</td>
      <td className="px-3 py-2">
        {row.planAccount ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-ink">{row.planAccount.name}</span>
            <button
              type="button"
              className="btn-ghost px-2 py-1 text-xs"
              disabled={busy}
              aria-label={`Disconnect ${row.name}`}
              onClick={() => act({ action: "disconnect", planAccountId: row.planAccount!.id })}
            >
              Disconnect
            </button>
          </div>
        ) : draft?.kind === "connect" ? (
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label={`Plan account for ${row.name}`}
              className={`${selectBaseClassName} max-w-60`}
              value={draft.planAccountId}
              onChange={(e) => setDraft({ kind: "connect", planAccountId: e.target.value })}
            >
              <option value="">Choose an account…</option>
              {ranked.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {usd.format(c.value)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-primary px-2 py-1 text-xs"
              disabled={busy || !draft.planAccountId}
              aria-label="Confirm connect"
              onClick={() => act({ action: "connect", externalId: row.externalId, planAccountId: draft.planAccountId })}
            >
              Connect
            </button>
            <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        ) : draft?.kind === "add" ? (
          <AddForm row={row} hasSpouse={panel.hasSpouse} draft={draft} busy={busy} setDraft={setDraft} act={act} />
        ) : (
          <div className="flex items-center justify-between gap-3">
            <span className="text-ink-3">Not connected</span>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-ghost px-2 py-1 text-xs"
                disabled={busy}
                aria-label={`Connect ${row.name}`}
                onClick={() => setDraft({ kind: "connect", planAccountId: "" })}
              >
                Connect
              </button>
              <button
                type="button"
                className="btn-ghost px-2 py-1 text-xs"
                disabled={busy}
                aria-label={`Add ${row.name} as new`}
                onClick={() => setDraft({ kind: "add", subType: row.guessedSubType, owner: "client" })}
              >
                Add as new
              </button>
            </div>
          </div>
        )}
      </td>
    </tr>
  );
}

function AddForm({
  row,
  hasSpouse,
  draft,
  busy,
  setDraft,
  act,
}: {
  row: PanelAccountRow;
  hasSpouse: boolean;
  draft: Extract<Draft, { kind: "add" }>;
  busy: boolean;
  setDraft: (d: Draft | null) => void;
  act: (body: Record<string, unknown>) => Promise<void>;
}) {
  const category = categoryFor(draft.subType, row.guessedCategory);
  // Retirement accounts have one owner; joint is for taxable, cash and the like.
  const joint = hasSpouse && category !== "retirement";
  const owner = draft.owner === "joint" && !joint ? "client" : draft.owner;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label={`Type for ${row.name}`}
        className={selectBaseClassName}
        value={draft.subType}
        onChange={(e) => setDraft({ ...draft, subType: e.target.value as AccountSubType })}
      >
        {SUB_TYPE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        aria-label={`Owner for ${row.name}`}
        className={selectBaseClassName}
        value={owner}
        onChange={(e) => setDraft({ ...draft, owner: e.target.value as "client" | "spouse" | "joint" })}
      >
        <option value="client">Client</option>
        {hasSpouse && <option value="spouse">{CO_CLIENT_LABEL}</option>}
        {joint && <option value="joint">Joint</option>}
      </select>
      <button
        type="button"
        className="btn-primary px-2 py-1 text-xs"
        disabled={busy}
        aria-label="Confirm add"
        onClick={() => act({ action: "add", externalId: row.externalId, category, subType: draft.subType, owner })}
      >
        Add
      </button>
      <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setDraft(null)}>
        Cancel
      </button>
    </div>
  );
}
