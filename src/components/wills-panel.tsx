"use client";

import { useEffect, useState } from "react";

export type WillGrantor = "client" | "spouse";
export type WillAssetMode = "specific" | "all_assets";
export type WillCondition = "if_spouse_survives" | "if_spouse_predeceased" | "always";
export type WillRecipientKind =
  | "family_member"
  | "external_beneficiary"
  | "entity"
  | "spouse";

export interface WillsPanelRecipient {
  id?: string;
  recipientKind: WillRecipientKind;
  recipientId: string | null;
  percentage: number;
  sortOrder: number;
}

export interface WillsPanelAssetBequest {
  kind: "asset";
  id?: string;
  name: string;
  assetMode: WillAssetMode;
  accountId: string | null;
  percentage: number;
  condition: WillCondition;
  sortOrder: number;
  recipients: WillsPanelRecipient[];
}

export interface WillsPanelLiabilityBequest {
  kind: "liability";
  id?: string;
  name: string;
  liabilityId: string | null;
  percentage: number;
  condition: "always";
  sortOrder: number;
  recipients: WillsPanelRecipient[];
}

export type WillsPanelBequest = WillsPanelAssetBequest | WillsPanelLiabilityBequest;

export interface WillsPanelWill {
  id: string;
  grantor: WillGrantor;
  bequests: WillsPanelBequest[];
}

export interface WillsPanelPrimary {
  firstName: string;
  lastName: string;
  spouseName: string | null;
  spouseLastName: string | null;
}

export interface WillsPanelAccount {
  id: string;
  name: string;
  category: string;
}

export interface WillsPanelLiability {
  id: string;
  name: string;
  balance: number;
  linkedPropertyId: string | null;
  ownerEntityId: string | null;
}

export interface WillsPanelFamilyMember {
  id: string;
  firstName: string;
  lastName: string | null;
}

export interface WillsPanelExternal {
  id: string;
  name: string;
}

export interface WillsPanelEntity {
  id: string;
  name: string;
}

interface WillsPanelProps {
  clientId: string;
  primary: WillsPanelPrimary;
  accounts: WillsPanelAccount[];
  liabilities: WillsPanelLiability[];
  familyMembers: WillsPanelFamilyMember[];
  externalBeneficiaries: WillsPanelExternal[];
  entities: WillsPanelEntity[];
  initialWills: WillsPanelWill[];
}

const CONDITION_LABEL: Record<WillCondition, string> = {
  if_spouse_survives: "If spouse survives",
  if_spouse_predeceased: "If spouse predeceases",
  always: "Always",
};

function grantorFullName(grantor: WillGrantor, p: WillsPanelPrimary): string {
  if (grantor === "client") return `${p.firstName} ${p.lastName}`;
  return `${p.spouseName ?? ""} ${p.spouseLastName ?? p.lastName ?? ""}`.trim();
}

function recipientLabel(
  r: WillsPanelRecipient,
  fams: WillsPanelFamilyMember[],
  exts: WillsPanelExternal[],
  ents: WillsPanelEntity[],
  p: WillsPanelPrimary,
): string {
  if (r.recipientKind === "spouse") {
    return `${p.spouseName ?? "Spouse"} (spouse)`;
  }
  if (r.recipientKind === "family_member") {
    const f = fams.find((x) => x.id === r.recipientId);
    return f ? `${f.firstName} ${f.lastName ?? ""}`.trim() : "(family member)";
  }
  if (r.recipientKind === "external_beneficiary") {
    const e = exts.find((x) => x.id === r.recipientId);
    return e ? e.name : "(external beneficiary)";
  }
  const en = ents.find((x) => x.id === r.recipientId);
  return en ? en.name : "(entity)";
}

// ─── Asset draft ─────────────────────────────────────────────────────────────

type AssetDraft = Omit<WillsPanelAssetBequest, "kind">;
type LiabilityDraft = Omit<WillsPanelLiabilityBequest, "kind">;

// ─── Debt bequest dialog ──────────────────────────────────────────────────────

interface DebtBequestDialogProps {
  draft: LiabilityDraft;
  setDraft: (d: LiabilityDraft) => void;
  liabilities: WillsPanelLiability[];
  alreadyBequeathedIds: string[];
  familyMembers: WillsPanelFamilyMember[];
  entities: WillsPanelEntity[];
  editingIndex: number | null;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}

function DebtBequestDialog({
  draft,
  setDraft,
  liabilities,
  alreadyBequeathedIds,
  familyMembers,
  entities,
  editingIndex,
  saving,
  onCancel,
  onSave,
}: DebtBequestDialogProps) {
  const recipientSum = draft.recipients.reduce((s, x) => s + x.percentage, 0);
  const recipientSumOk = recipientSum > 0 && recipientSum <= 100.01;
  const remainder = Math.round((100 - recipientSum) * 100) / 100;

  // Eligible: unlinked + not entity-owned
  const eligibleLiabilities = liabilities.filter(
    (l) => l.linkedPropertyId == null && l.ownerEntityId == null,
  );

  const canSave = !!draft.liabilityId && recipientSumOk && !saving;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={editingIndex != null ? "Edit debt bequest" : "New debt bequest"}
      onClick={onCancel}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-lg border border-gray-700 bg-gray-900 p-5"
      >
        <h3 className="mb-4 text-base font-semibold text-gray-100">
          {editingIndex != null ? "Edit debt bequest" : "New debt bequest"}
        </h3>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-gray-300">Liability</span>
          <select
            value={draft.liabilityId ?? ""}
            onChange={(e) => {
              const liab = liabilities.find((l) => l.id === e.target.value);
              setDraft({
                ...draft,
                liabilityId: e.target.value || null,
                name: liab?.name ?? "",
              });
            }}
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-gray-100"
          >
            <option value="">— select a liability —</option>
            {eligibleLiabilities.map((l) => {
              const disabled =
                alreadyBequeathedIds.includes(l.id) && l.id !== draft.liabilityId;
              return (
                <option
                  key={l.id}
                  value={l.id}
                  disabled={disabled}
                  aria-disabled={disabled}
                >
                  {l.name}
                  {disabled ? " (already bequeathed)" : ""}
                </option>
              );
            })}
          </select>
        </label>

        <fieldset className="mb-4">
          <legend className="mb-2 text-sm text-gray-300">Recipients</legend>
          {draft.recipients.map((r, i) => (
            <div key={i} className="mb-2 flex items-center gap-2">
              <select
                value={r.recipientKind}
                aria-label="Recipient kind"
                onChange={(e) => {
                  const nextKind = e.target.value as "family_member" | "entity";
                  const next = [...draft.recipients];
                  next[i] = {
                    ...r,
                    recipientKind: nextKind,
                    recipientId:
                      nextKind === "family_member"
                        ? familyMembers[0]?.id ?? null
                        : entities[0]?.id ?? null,
                  };
                  setDraft({ ...draft, recipients: next });
                }}
                className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-100"
              >
                <option value="family_member">Family member</option>
                <option value="entity">Entity / Trust</option>
              </select>
              <select
                value={r.recipientId ?? ""}
                aria-label="Recipient name"
                onChange={(e) => {
                  const next = [...draft.recipients];
                  next[i] = { ...r, recipientId: e.target.value };
                  setDraft({ ...draft, recipients: next });
                }}
                className="flex-1 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-100"
              >
                {r.recipientKind === "family_member" &&
                  familyMembers.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.firstName} {f.lastName ?? ""}
                    </option>
                  ))}
                {r.recipientKind === "entity" &&
                  entities.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
              <input
                type="number"
                min={0.01}
                max={100}
                step={0.01}
                aria-label="Recipient percentage"
                value={r.percentage}
                onChange={(e) => {
                  const next = [...draft.recipients];
                  next[i] = { ...r, percentage: parseFloat(e.target.value) || 0 };
                  setDraft({ ...draft, recipients: next });
                }}
                className="w-20 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-100"
              />
              <button
                type="button"
                onClick={() => {
                  const next = draft.recipients.filter((_, j) => j !== i);
                  setDraft({ ...draft, recipients: next });
                }}
                className="rounded-md border border-gray-700 px-2 py-1 text-sm text-gray-300 hover:bg-gray-800"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              const sortOrder = draft.recipients.length;
              setDraft({
                ...draft,
                recipients: [
                  ...draft.recipients,
                  {
                    recipientKind: "family_member",
                    recipientId: familyMembers[0]?.id ?? null,
                    percentage: 0,
                    sortOrder,
                  },
                ],
              });
            }}
            className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-100 hover:bg-gray-700"
          >
            + Add recipient
          </button>
          <p className="mt-2 text-xs text-gray-400">
            Total:{" "}
            <span className={recipientSumOk ? "text-green-400" : "text-red-400"}>
              {recipientSum.toFixed(2)}%
            </span>
          </p>
          {recipientSumOk && remainder > 0.009 && (
            <p className="mt-1 text-xs text-gray-500">
              Recipients sum to {recipientSum.toFixed(2)}% — remainder ({remainder.toFixed(2)}%) falls
              to estate creditor-payoff
            </p>
          )}
        </fieldset>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-100 hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={onSave}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function WillsPanel(props: WillsPanelProps) {
  const {
    primary,
    initialWills,
    accounts,
    liabilities,
    familyMembers,
    externalBeneficiaries,
    entities,
  } = props;
  const [wills, setWills] = useState<WillsPanelWill[]>(initialWills);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "asset" dialog state
  const [assetModalOpen, setAssetModalOpen] = useState<WillGrantor | null>(null);
  // "liability" dialog state
  const [debtModalOpen, setDebtModalOpen] = useState<WillGrantor | null>(null);

  // ESC-to-close
  useEffect(() => {
    const anyOpen = assetModalOpen ?? debtModalOpen;
    if (!anyOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAssetModalOpen(null);
        setDebtModalOpen(null);
        setEditingIndex(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [assetModalOpen, debtModalOpen]);

  const [assetDraft, setAssetDraft] = useState<AssetDraft>({
    name: "",
    assetMode: "specific",
    accountId: null,
    percentage: 100,
    condition: "always",
    sortOrder: 0,
    recipients: [
      { recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 },
    ],
  });

  const [liabilityDraft, setLiabilityDraft] = useState<LiabilityDraft>({
    name: "",
    liabilityId: null,
    percentage: 100,
    condition: "always",
    sortOrder: 0,
    recipients: [
      { recipientKind: "family_member", recipientId: familyMembers[0]?.id ?? null, percentage: 100, sortOrder: 0 },
    ],
  });

  async function fetchWill(willId: string): Promise<WillsPanelWill | null> {
    const res = await fetch(`/api/clients/${props.clientId}/wills/${willId}`);
    if (!res.ok) return null;
    return (await res.json()) as WillsPanelWill;
  }

  async function saveWill(g: WillGrantor, nextBequests: WillsPanelBequest[]) {
    setSaving(true);
    setError(null);
    try {
      const existing = wills.find((w) => w.grantor === g);
      let willId: string;
      if (!existing) {
        const res = await fetch(`/api/clients/${props.clientId}/wills`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ grantor: g, bequests: nextBequests }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const out = (await res.json()) as { id: string };
        willId = out.id;
      } else {
        const res = await fetch(
          `/api/clients/${props.clientId}/wills/${existing.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bequests: nextBequests }),
          },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        willId = existing.id;
      }
      const hydrated = await fetchWill(willId);
      if (hydrated) {
        setWills((prev) => [...prev.filter((w) => w.grantor !== g), hydrated]);
      } else {
        setWills((prev) => {
          const rest = prev.filter((w) => w.grantor !== g);
          return [...rest, { id: willId, grantor: g, bequests: nextBequests }];
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function deleteWill(g: WillGrantor, willId: string) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/clients/${props.clientId}/wills/${willId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setWills((prev) => prev.filter((w) => w.grantor !== g));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  }

  const warnings: { grantor: WillGrantor; text: string }[] = [];
  for (const w of wills) {
    const byKey = new Map<string, number>();
    for (const b of w.bequests) {
      if (b.kind !== "asset" || b.assetMode !== "specific" || !b.accountId) continue;
      const key = `${b.accountId}|${b.condition}`;
      byKey.set(key, (byKey.get(key) ?? 0) + b.percentage);
    }
    for (const [key, sum] of byKey.entries()) {
      if (sum > 100.01) {
        const [accountId, condition] = key.split("|");
        const acct = accounts.find((a) => a.id === accountId)?.name ?? accountId;
        warnings.push({
          grantor: w.grantor,
          text: `${acct}: over-allocated at "${condition}" (${sum.toFixed(2)}%)`,
        });
      }
    }
  }

  return (
    <div className="space-y-8">
      {saving && <div className="text-xs text-gray-400">Saving…</div>}
      {error && <div className="text-xs text-red-400">{error}</div>}
      {(["client", "spouse"] as const).map((g) => {
        if (g === "spouse" && !primary.spouseName) return null;
        const will = wills.find((w) => w.grantor === g);
        const grantorWarnings = warnings.filter((x) => x.grantor === g);
        const heading = grantorFullName(g, primary) || (g === "client" ? "Client" : "Spouse");

        const assetBequests = (will?.bequests ?? []).filter(
          (b): b is WillsPanelAssetBequest => b.kind === "asset",
        );
        const liabilityBequests = (will?.bequests ?? []).filter(
          (b): b is WillsPanelLiabilityBequest => b.kind === "liability",
        );

        return (
          <section key={g} className="rounded-lg border border-gray-800 bg-gray-900/40 p-5">
            <header className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-100">
                {heading}&apos;s Will
              </h2>
              <div className="flex items-center gap-2">
                {will && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={async () => {
                      if (!confirm("Delete this will and all its bequests?")) return;
                      await deleteWill(g, will.id);
                    }}
                    className="rounded-md border border-red-800 bg-red-900/20 px-3 py-1.5 text-sm text-red-300 hover:bg-red-900/40 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Delete will
                  </button>
                )}
                <button
                  type="button"
                  disabled={saving}
                  className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-100 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => {
                    const hasAccounts = accounts.length > 0;
                    setAssetDraft({
                      name: "",
                      assetMode: hasAccounts ? "specific" : "all_assets",
                      accountId: hasAccounts ? accounts[0].id : null,
                      percentage: 100,
                      condition: "always",
                      sortOrder: will?.bequests.length ?? 0,
                      recipients: [
                        { recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 },
                      ],
                    });
                    setEditingIndex(null);
                    setAssetModalOpen(g);
                  }}
                >
                  + Add bequest
                </button>
              </div>
            </header>
            {grantorWarnings.length > 0 && (
              <div className="mb-3 rounded-md border border-amber-700 bg-amber-900/20 p-3 text-xs text-amber-300">
                <p className="mb-1 font-semibold">Allocation warnings</p>
                <ul className="list-disc pl-4">
                  {grantorWarnings.map((x, i) => (
                    <li key={i}>{x.text}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Asset bequests section */}
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-medium text-gray-400">Asset bequests</h3>
              {assetBequests.length === 0 ? (
                <p className="text-sm text-gray-500">No bequests yet.</p>
              ) : (
                <ol className="space-y-2">
                  {assetBequests.map((b, idx) => {
                    const assetLabel =
                      b.assetMode === "all_assets"
                        ? "All other assets"
                        : accounts.find((a) => a.id === b.accountId)?.name ??
                          "(unknown account)";
                    // Global index in full bequests list
                    const globalIdx = will!.bequests.indexOf(b);
                    return (
                      <li
                        key={b.id ?? `a-${idx}`}
                        className="rounded-md border border-gray-800 bg-gray-900 p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-gray-100">{b.name}</p>
                            <p className="text-sm text-gray-400">
                              {b.percentage}% of {assetLabel}
                            </p>
                            <p className="mt-1 text-xs text-gray-500">
                              {CONDITION_LABEL[b.condition]}
                            </p>
                            <p className="mt-1 text-xs text-gray-400">
                              {b.recipients
                                .map(
                                  (r) =>
                                    `${recipientLabel(r, familyMembers, externalBeneficiaries, entities, primary)} (${r.percentage}%)`,
                                )
                                .join(", ")}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              aria-label="Move up"
                              disabled={globalIdx === 0 || saving}
                              onClick={async () => {
                                const next = [...(will?.bequests ?? [])];
                                const tmp = next[globalIdx - 1];
                                next[globalIdx - 1] = { ...next[globalIdx], sortOrder: globalIdx - 1 };
                                next[globalIdx] = { ...tmp, sortOrder: globalIdx };
                                await saveWill(g, next);
                              }}
                              className="rounded border border-gray-700 px-2 py-0.5 text-xs text-gray-300 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              aria-label="Move down"
                              disabled={globalIdx === (will?.bequests.length ?? 1) - 1 || saving}
                              onClick={async () => {
                                const next = [...(will?.bequests ?? [])];
                                const tmp = next[globalIdx + 1];
                                next[globalIdx + 1] = { ...next[globalIdx], sortOrder: globalIdx + 1 };
                                next[globalIdx] = { ...tmp, sortOrder: globalIdx };
                                await saveWill(g, next);
                              }}
                              className="rounded border border-gray-700 px-2 py-0.5 text-xs text-gray-300 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => {
                                setAssetDraft(b);
                                setEditingIndex(globalIdx);
                                setAssetModalOpen(g);
                              }}
                              className="rounded border border-gray-700 px-2 py-0.5 text-xs text-gray-300 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              disabled={saving}
                              onClick={async () => {
                                const next = (will?.bequests ?? [])
                                  .filter((_, i) => i !== globalIdx)
                                  .map((x, i) => ({ ...x, sortOrder: i }));
                                await saveWill(g, next);
                              }}
                              className="rounded border border-gray-700 px-2 py-0.5 text-xs text-red-300 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>

            {/* Debt bequests section */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-medium text-gray-400">Debt bequests</h3>
                <button
                  type="button"
                  disabled={saving}
                  className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-100 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => {
                    setLiabilityDraft({
                      name: "",
                      liabilityId: null,
                      percentage: 100,
                      condition: "always",
                      sortOrder: will?.bequests.length ?? 0,
                      recipients: [
                        {
                          recipientKind: "family_member",
                          recipientId: familyMembers[0]?.id ?? null,
                          percentage: 100,
                          sortOrder: 0,
                        },
                      ],
                    });
                    setEditingIndex(null);
                    setDebtModalOpen(g);
                  }}
                >
                  + Add debt bequest
                </button>
              </div>
              {liabilityBequests.length === 0 ? (
                <p className="text-sm text-gray-500">No debt bequests yet.</p>
              ) : (
                <ol className="space-y-2">
                  {liabilityBequests.map((b, idx) => {
                    const liab = liabilities.find((l) => l.id === b.liabilityId);
                    const recipientSum = b.recipients.reduce((s, r) => s + r.percentage, 0);
                    const remainder = Math.round((100 - recipientSum) * 100) / 100;
                    const isPartial = remainder > 0.009;
                    const globalIdx = will!.bequests.indexOf(b);
                    return (
                      <li
                        key={b.id ?? `l-${idx}`}
                        className="rounded-md border border-gray-800 bg-gray-900 p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-gray-100">{b.name}</p>
                            {liab && (
                              <p className="text-sm text-gray-400">
                                Balance: ${liab.balance.toLocaleString()}
                              </p>
                            )}
                            <p className="mt-1 text-xs text-gray-400">
                              {b.recipients
                                .map(
                                  (r) =>
                                    `${recipientLabel(r, familyMembers, externalBeneficiaries, entities, primary)} (${r.percentage}%)`,
                                )
                                .join(", ")}
                              {isPartial && (
                                <span className="ml-1 text-gray-500">
                                  · {remainder.toFixed(2)}% to estate creditor-payoff
                                </span>
                              )}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              aria-label="Move up"
                              disabled={globalIdx === 0 || saving}
                              onClick={async () => {
                                const next = [...(will?.bequests ?? [])];
                                const tmp = next[globalIdx - 1];
                                next[globalIdx - 1] = { ...next[globalIdx], sortOrder: globalIdx - 1 };
                                next[globalIdx] = { ...tmp, sortOrder: globalIdx };
                                await saveWill(g, next);
                              }}
                              className="rounded border border-gray-700 px-2 py-0.5 text-xs text-gray-300 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              aria-label="Move down"
                              disabled={globalIdx === (will?.bequests.length ?? 1) - 1 || saving}
                              onClick={async () => {
                                const next = [...(will?.bequests ?? [])];
                                const tmp = next[globalIdx + 1];
                                next[globalIdx + 1] = { ...next[globalIdx], sortOrder: globalIdx + 1 };
                                next[globalIdx] = { ...tmp, sortOrder: globalIdx };
                                await saveWill(g, next);
                              }}
                              className="rounded border border-gray-700 px-2 py-0.5 text-xs text-gray-300 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => {
                                setLiabilityDraft(b);
                                setEditingIndex(globalIdx);
                                setDebtModalOpen(g);
                              }}
                              className="rounded border border-gray-700 px-2 py-0.5 text-xs text-gray-300 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              disabled={saving}
                              onClick={async () => {
                                const next = (will?.bequests ?? [])
                                  .filter((_, i) => i !== globalIdx)
                                  .map((x, i) => ({ ...x, sortOrder: i }));
                                await saveWill(g, next);
                              }}
                              className="rounded border border-gray-700 px-2 py-0.5 text-xs text-red-300 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </section>
        );
      })}

      {/* Asset bequest modal */}
      {assetModalOpen && (() => {
        const recipientSum = assetDraft.recipients.reduce((s, x) => s + x.percentage, 0);
        const recipientSumOk = Math.abs(recipientSum - 100) < 0.01;
        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={editingIndex != null ? "Edit bequest" : "New bequest"}
            onClick={() => {
              setAssetModalOpen(null);
              setEditingIndex(null);
            }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg rounded-lg border border-gray-700 bg-gray-900 p-5"
            >
              <h3 className="mb-4 text-base font-semibold text-gray-100">
                {editingIndex != null ? "Edit bequest" : "New bequest"}
              </h3>

              <label className="mb-3 block text-sm">
                <span className="mb-1 block text-gray-300">Name</span>
                <input
                  type="text"
                  value={assetDraft.name}
                  onChange={(e) => setAssetDraft({ ...assetDraft, name: e.target.value })}
                  className="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-gray-100"
                />
              </label>

              <label className="mb-3 block text-sm">
                <span className="mb-1 block text-gray-300">Asset</span>
                <select
                  value={assetDraft.assetMode === "all_assets" ? "__residual__" : (assetDraft.accountId ?? "")}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__residual__") {
                      setAssetDraft({ ...assetDraft, assetMode: "all_assets", accountId: null });
                    } else {
                      setAssetDraft({ ...assetDraft, assetMode: "specific", accountId: v });
                    }
                  }}
                  className="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-gray-100"
                >
                  <option value="__residual__">All other assets</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </label>

              <label className="mb-3 block text-sm">
                <span className="mb-1 block text-gray-300">Percentage</span>
                <input
                  type="number"
                  min={0.01}
                  max={100}
                  step={0.01}
                  value={assetDraft.percentage}
                  onChange={(e) => setAssetDraft({ ...assetDraft, percentage: parseFloat(e.target.value) || 0 })}
                  className="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-gray-100"
                />
              </label>

              <label className="mb-3 block text-sm">
                <span className="mb-1 block text-gray-300">Condition</span>
                <select
                  value={assetDraft.condition}
                  onChange={(e) => setAssetDraft({ ...assetDraft, condition: e.target.value as WillCondition })}
                  className="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-gray-100"
                >
                  <option value="always">Always</option>
                  <option value="if_spouse_survives">If spouse survives</option>
                  <option value="if_spouse_predeceased">If spouse predeceases</option>
                </select>
              </label>

              <fieldset className="mb-4">
                <legend className="mb-2 text-sm text-gray-300">Recipients</legend>
                {assetDraft.recipients.map((r, i) => (
                  <div key={i} className="mb-2 flex items-center gap-2">
                    <select
                      value={r.recipientKind}
                      onChange={(e) => {
                        const nextKind = e.target.value as WillRecipientKind;
                        const next = [...assetDraft.recipients];
                        next[i] = {
                          ...r,
                          recipientKind: nextKind,
                          recipientId: nextKind === "spouse" ? null : (
                            nextKind === "family_member" ? familyMembers[0]?.id ?? null :
                            nextKind === "external_beneficiary" ? externalBeneficiaries[0]?.id ?? null :
                            entities[0]?.id ?? null
                          ),
                        };
                        setAssetDraft({ ...assetDraft, recipients: next });
                      }}
                      className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-100"
                    >
                      <option value="spouse">Spouse</option>
                      <option value="family_member">Family member</option>
                      <option value="external_beneficiary">External beneficiary</option>
                      <option value="entity">Entity / Trust</option>
                    </select>
                    {r.recipientKind !== "spouse" && (
                      <select
                        value={r.recipientId ?? ""}
                        onChange={(e) => {
                          const next = [...assetDraft.recipients];
                          next[i] = { ...r, recipientId: e.target.value };
                          setAssetDraft({ ...assetDraft, recipients: next });
                        }}
                        className="flex-1 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-100"
                      >
                        {r.recipientKind === "family_member" &&
                          familyMembers.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.firstName} {f.lastName ?? ""}
                            </option>
                          ))}
                        {r.recipientKind === "external_beneficiary" &&
                          externalBeneficiaries.map((x) => (
                            <option key={x.id} value={x.id}>{x.name}</option>
                          ))}
                        {r.recipientKind === "entity" &&
                          entities.map((x) => (
                            <option key={x.id} value={x.id}>{x.name}</option>
                          ))}
                      </select>
                    )}
                    <input
                      type="number"
                      min={0.01}
                      max={100}
                      step={0.01}
                      value={r.percentage}
                      onChange={(e) => {
                        const next = [...assetDraft.recipients];
                        next[i] = { ...r, percentage: parseFloat(e.target.value) || 0 };
                        setAssetDraft({ ...assetDraft, recipients: next });
                      }}
                      className="w-20 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-100"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const next = assetDraft.recipients.filter((_, j) => j !== i);
                        setAssetDraft({ ...assetDraft, recipients: next });
                      }}
                      className="rounded-md border border-gray-700 px-2 py-1 text-sm text-gray-300 hover:bg-gray-800"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    const sortOrder = assetDraft.recipients.length;
                    setAssetDraft({
                      ...assetDraft,
                      recipients: [
                        ...assetDraft.recipients,
                        {
                          recipientKind: "family_member",
                          recipientId: familyMembers[0]?.id ?? null,
                          percentage: 0,
                          sortOrder,
                        },
                      ],
                    });
                  }}
                  className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-100 hover:bg-gray-700"
                >
                  + Add recipient
                </button>
                <p className="mt-2 text-xs text-gray-400">
                  Total:{" "}
                  <span className={recipientSumOk ? "text-green-400" : "text-red-400"}>
                    {recipientSum.toFixed(2)}%
                  </span>
                </p>
              </fieldset>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAssetModalOpen(null);
                    setEditingIndex(null);
                  }}
                  className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-100 hover:bg-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!assetDraft.name.trim() || !recipientSumOk || saving}
                  onClick={async () => {
                    if (!assetModalOpen) return;
                    const g = assetModalOpen;
                    const existing = wills.find((w) => w.grantor === g)?.bequests ?? [];
                    let next: WillsPanelBequest[];
                    const assetBequest: WillsPanelAssetBequest = { kind: "asset", ...assetDraft };
                    if (editingIndex != null) {
                      next = existing.map((b, i) =>
                        i === editingIndex
                          ? { ...assetBequest, sortOrder: i, id: b.id }
                          : b,
                      );
                    } else {
                      next = [...existing, { ...assetBequest, sortOrder: existing.length }];
                    }
                    await saveWill(g, next);
                    setAssetModalOpen(null);
                    setEditingIndex(null);
                  }}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Debt bequest modal */}
      {debtModalOpen && (
        <DebtBequestDialog
          draft={liabilityDraft}
          setDraft={setLiabilityDraft}
          liabilities={liabilities}
          alreadyBequeathedIds={
            (wills.find((w) => w.grantor === debtModalOpen)?.bequests ?? [])
              .filter((b): b is WillsPanelLiabilityBequest => b.kind === "liability")
              .map((b) => b.liabilityId!)
              .filter(Boolean)
          }
          familyMembers={familyMembers}
          entities={entities}
          editingIndex={editingIndex}
          saving={saving}
          onCancel={() => {
            setDebtModalOpen(null);
            setEditingIndex(null);
          }}
          onSave={async () => {
            if (!debtModalOpen) return;
            const g = debtModalOpen;
            const existing = wills.find((w) => w.grantor === g)?.bequests ?? [];
            const liabilityBequest: WillsPanelLiabilityBequest = {
              kind: "liability",
              ...liabilityDraft,
            };
            let next: WillsPanelBequest[];
            if (editingIndex != null) {
              next = existing.map((b, i) =>
                i === editingIndex
                  ? { ...liabilityBequest, sortOrder: i, id: b.id }
                  : b,
              );
            } else {
              next = [...existing, { ...liabilityBequest, sortOrder: existing.length }];
            }
            await saveWill(g, next);
            setDebtModalOpen(null);
            setEditingIndex(null);
          }}
        />
      )}
    </div>
  );
}
