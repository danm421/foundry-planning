"use client";

import { useState } from "react";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import MoneyText from "@/components/money-text";
import { fieldLabelClassName } from "@/components/forms/input-styles";
import ReparentPickerDialog from "./reparent-picker-dialog";
import ReparentConfirmDialog from "./reparent-confirm-dialog";

export interface BusinessAssetsTabProps {
  clientId: string;
  businessId: string;
  businessName: string;
  allAccounts: Array<{
    id: string;
    name: string;
    value: number | string;
    category: string;
    subType?: string | null;
    parentAccountId?: string | null;
    isDefaultChecking?: boolean;
    owners?: Array<
      | { kind: "family_member"; familyMemberId: string; percent: number }
      | { kind: "entity"; entityId: string; percent: number }
      | { kind: "external_beneficiary"; externalBeneficiaryId: string; percent: number }
      | { kind: "gifted_away"; recipient: { kind: "family_member" | "entity" | "external_beneficiary"; id: string }; percent: number }
    >;
  }>;
  allLiabilities: Array<{
    id: string;
    name: string;
    balance: number | string;
    parentAccountId?: string | null;
    owners?: Array<
      | { kind: "family_member"; familyMemberId: string; percent: number }
      | { kind: "entity"; entityId: string; percent: number }
      | { kind: "external_beneficiary"; externalBeneficiaryId: string; percent: number }
      | { kind: "gifted_away"; recipient: { kind: "family_member" | "entity" | "external_beneficiary"; id: string }; percent: number }
    >;
  }>;
  familyMembers: Array<{ id: string; firstName: string }>;
  hidden: boolean;
  onChanged: () => void;
  onOpenAddAccount: (businessId: string) => void;
  onOpenAddLiability: (businessId: string) => void;
}

function toNum(v: number | string): number {
  return typeof v === "number" ? v : parseFloat(v as string) || 0;
}

type RemoveTarget = { kind: "account" | "liability"; id: string; name: string };
type PendingReparent = {
  kind: "account" | "liability";
  id: string;
  name: string;
  currentOwnersLabel: string;
};

export default function BusinessAssetsTab({
  clientId,
  businessId,
  businessName,
  allAccounts,
  allLiabilities,
  familyMembers,
  hidden,
  onChanged,
  onOpenAddAccount,
  onOpenAddLiability,
}: BusinessAssetsTabProps) {
  const writer = useScenarioWriter(clientId);
  const [removing, setRemoving] = useState<RemoveTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingReparent, setPendingReparent] = useState<PendingReparent | null>(null);
  const [reparentLoading, setReparentLoading] = useState(false);

  const ownedAccounts = allAccounts.filter((a) => (a.parentAccountId ?? null) === businessId);
  const ownedLiabilities = allLiabilities.filter((l) => (l.parentAccountId ?? null) === businessId);
  const isEmpty = ownedAccounts.length === 0 && ownedLiabilities.length === 0;

  const total =
    ownedAccounts.reduce((s, a) => s + toNum(a.value), 0) -
    ownedLiabilities.reduce((s, l) => s + toNum(l.balance), 0);

  function labelOwners(target: { kind: "account" | "liability"; id: string }): string {
    const item =
      target.kind === "account"
        ? allAccounts.find((a) => a.id === target.id)
        : allLiabilities.find((l) => l.id === target.id);
    const owners = item?.owners ?? [];
    if (owners.length === 0) return "Nobody";
    return owners
      .map((o) =>
        o.kind === "family_member"
          ? `${familyMembers.find((m) => m.id === o.familyMemberId)?.firstName ?? "?"} (${Math.round(o.percent * 100)}%)`
          : o.kind === "entity"
          ? `Entity (${Math.round(o.percent * 100)}%)`
          : `Beneficiary (${Math.round(o.percent * 100)}%)`,
      )
      .join(", ");
  }

  async function performRemove(target: RemoveTarget) {
    setError(null);
    const url =
      target.kind === "account"
        ? `/api/clients/${clientId}/accounts/${target.id}`
        : `/api/clients/${clientId}/liabilities/${target.id}`;
    try {
      const res = await writer.submit(
        {
          op: "edit",
          targetKind: target.kind,
          targetId: target.id,
          desiredFields: { parentAccountId: null },
        },
        { url, method: "PUT", body: { parentAccountId: null } },
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(json.error ?? "Failed to remove from business");
        return;
      }
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove from business");
    } finally {
      setRemoving(null);
    }
  }

  async function confirmReparent() {
    if (!pendingReparent || reparentLoading) return;
    setReparentLoading(true);
    setError(null);
    const url =
      pendingReparent.kind === "account"
        ? `/api/clients/${clientId}/accounts/${pendingReparent.id}`
        : `/api/clients/${clientId}/liabilities/${pendingReparent.id}`;
    try {
      const res = await writer.submit(
        {
          op: "edit",
          targetKind: pendingReparent.kind,
          targetId: pendingReparent.id,
          desiredFields: { parentAccountId: businessId },
        },
        { url, method: "PUT", body: { parentAccountId: businessId } },
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(json.error ?? "Failed to reassign");
        return;
      }
      setPendingReparent(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reassign");
    } finally {
      setReparentLoading(false);
    }
  }

  return (
    <div className={hidden ? "hidden" : "space-y-4"}>
      {error && (
        <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>
      )}

      <div className="flex items-center justify-between rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2">
        <span className="text-[12px] font-medium text-ink-3 uppercase tracking-wider">
          Net business asset value
        </span>
        <MoneyText value={total} className="text-[15px] font-semibold text-ink" />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onOpenAddAccount(businessId)}
          className="rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 h-8 text-[12px] font-medium text-ink-2 hover:bg-card-hover"
        >
          + Add sub-account
        </button>
        <button
          type="button"
          onClick={() => onOpenAddLiability(businessId)}
          className="rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 h-8 text-[12px] font-medium text-ink-2 hover:bg-card-hover"
        >
          + Add sub-liability
        </button>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 h-8 text-[12px] font-medium text-ink-2 hover:bg-card-hover"
        >
          + Reassign existing asset
        </button>
      </div>

      <div>
        <label className={fieldLabelClassName}>Accounts</label>
        {ownedAccounts.length === 0 && !isEmpty ? (
          <p className="text-[12px] text-ink-4 py-2">No accounts owned by this business.</p>
        ) : (
          <ul className="space-y-1.5">
            {ownedAccounts.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2"
              >
                <span className="flex-1 min-w-0 text-[13px] text-ink truncate">{a.name}</span>
                <span className="text-[11px] uppercase tracking-wider text-ink-4">{a.category}</span>
                <span className="text-[12px] tabular-nums text-ink-2"><MoneyText value={toNum(a.value)} /></span>
                {a.isDefaultChecking ? (
                  <span
                    title="System-managed cash account — locked"
                    className="text-[11px] uppercase tracking-wider text-ink-4 ml-1"
                  >
                    locked
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRemoving({ kind: "account", id: a.id, name: a.name })}
                    className="text-white hover:text-white text-[13px] ml-1"
                    aria-label={`Remove ${a.name} from business`}
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <label className={fieldLabelClassName}>Liabilities</label>
        {ownedLiabilities.length === 0 && !isEmpty ? (
          <p className="text-[12px] text-ink-4 py-2">No liabilities owned by this business.</p>
        ) : (
          <ul className="space-y-1.5">
            {ownedLiabilities.map((l) => (
              <li
                key={l.id}
                className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2"
              >
                <span className="flex-1 min-w-0 text-[13px] text-ink truncate">{l.name}</span>
                <span className="text-[12px] tabular-nums text-crit">
                  (<MoneyText value={toNum(l.balance)} />)
                </span>
                <button
                  type="button"
                  onClick={() => setRemoving({ kind: "liability", id: l.id, name: l.name })}
                  className="text-white hover:text-white text-[13px] ml-1"
                  aria-label={`Remove ${l.name} from business`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {isEmpty && (
        <p className="text-[12px] text-ink-4 text-center py-4">
          No assets or liabilities assigned to this business. Use the buttons above to add or
          reassign assets.
        </p>
      )}

      {removing && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-paper/70 backdrop-blur-sm" onClick={() => setRemoving(null)} />
          <div className="relative z-10 w-full max-w-[420px] rounded-[var(--radius)] border-2 border-ink-3 ring-1 ring-black/60 bg-card p-6 shadow-2xl">
            <p className="text-[14px] text-ink-2">
              Remove <strong className="text-ink">{removing.name}</strong> from{" "}
              <strong className="text-ink">{businessName}</strong>?
              <span className="mt-1 block text-[12px] text-ink-4">
                It will become standalone and have no owner. You&apos;ll need to set ownership
                by editing it directly.
              </span>
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setRemoving(null)}
                className="rounded-[var(--radius-sm)] border border-transparent px-4 h-9 text-[13px] font-medium text-ink-2 hover:text-ink hover:bg-card-hover hover:border-hair"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => performRemove(removing)}
                className="rounded-[var(--radius-sm)] px-4 h-9 text-[13px] font-medium text-crit hover:bg-card-hover"
                aria-label="Confirm remove"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      <ReparentPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        businessName={businessName}
        accounts={allAccounts}
        liabilities={allLiabilities}
        onPick={(t) => {
          setPickerOpen(false);
          setPendingReparent({ ...t, currentOwnersLabel: labelOwners(t) });
        }}
      />
      <ReparentConfirmDialog
        open={pendingReparent !== null}
        targetName={pendingReparent?.name ?? ""}
        businessName={businessName}
        currentOwnersLabel={pendingReparent?.currentOwnersLabel ?? ""}
        onCancel={() => setPendingReparent(null)}
        onConfirm={confirmReparent}
        loading={reparentLoading}
      />
    </div>
  );
}
