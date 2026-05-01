"use client";

import { useState } from "react";
import BequestDialog, { type BequestDraft } from "@/components/bequest-dialog";
import DialogShell from "@/components/dialog-shell";
import {
  selectClassName,
  fieldLabelClassName,
} from "@/components/forms/input-styles";
import BequestRecipientList from "@/components/forms/bequest-recipient-list";

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

const DEBT_FORM_ID = "debt-bequest-dialog-form";

interface DebtBequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: LiabilityDraft;
  setDraft: (d: LiabilityDraft) => void;
  liabilities: WillsPanelLiability[];
  alreadyBequeathedIds: string[];
  primary: WillsPanelPrimary;
  familyMembers: WillsPanelFamilyMember[];
  externalBeneficiaries: WillsPanelExternal[];
  entities: WillsPanelEntity[];
  isEdit: boolean;
  saving: boolean;
  onSave: () => void;
}

function DebtBequestDialog({
  open,
  onOpenChange,
  draft,
  setDraft,
  liabilities,
  alreadyBequeathedIds,
  primary,
  familyMembers,
  externalBeneficiaries,
  entities,
  isEdit,
  saving,
  onSave,
}: DebtBequestDialogProps) {
  const recipientSum = draft.recipients.reduce((s, x) => s + x.percentage, 0);
  const recipientSumOk = recipientSum > 0 && recipientSum <= 100.01;
  const remainder = Math.round((100 - recipientSum) * 100) / 100;

  // Eligible: unlinked + not entity-owned
  const eligibleLiabilities = liabilities.filter(
    (l) => l.linkedPropertyId == null && l.ownerEntityId == null,
  );

  const recipientsHaveIds = draft.recipients.every((r) => r.recipientId != null);
  const canSave = !!draft.liabilityId && recipientSumOk && recipientsHaveIds && !saving;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSave) return;
    onSave();
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Edit debt bequest" : "New debt bequest"}
      size="md"
      primaryAction={{
        label: saving ? "Saving…" : "Save",
        form: DEBT_FORM_ID,
        disabled: !canSave,
        loading: saving,
      }}
    >
      <form id={DEBT_FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={fieldLabelClassName}>Liability</label>
          <select
            aria-label="Liability"
            value={draft.liabilityId ?? ""}
            onChange={(e) => {
              const liab = liabilities.find((l) => l.id === e.target.value);
              setDraft({
                ...draft,
                liabilityId: e.target.value || null,
                name: liab?.name?.trim() || "(unnamed liability)",
              });
            }}
            className={selectClassName}
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
          {eligibleLiabilities.length === 0 && (
            <p className="mt-1.5 text-xs text-amber-400/80">
              No bequest-eligible liabilities exist. A liability must be
              unlinked (no linked property) and not owned by an entity.
            </p>
          )}
        </div>

        <BequestRecipientList
          mode="debt"
          rows={draft.recipients}
          onChange={(recipients) => setDraft({ ...draft, recipients })}
          primary={primary}
          familyMembers={familyMembers}
          externalBeneficiaries={externalBeneficiaries}
          entities={entities}
        />

        {recipientSumOk && remainder > 0.009 && (
          <p className="text-xs text-ink-3">
            Recipients sum to {recipientSum.toFixed(2)}% — remainder ({remainder.toFixed(2)}%) falls
            to estate creditor-payoff
          </p>
        )}
      </form>
    </DialogShell>
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
      {saving && <div className="text-xs text-gray-300">Saving…</div>}
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
              <h3 className="mb-2 text-sm font-medium text-gray-300">Asset bequests</h3>
              {assetBequests.length === 0 ? (
                <p className="text-sm text-gray-400">No bequests yet.</p>
              ) : (
                <ol className="space-y-2">
                  {assetBequests.map((b, idx) => {
                    const assetLabel =
                      b.assetMode === "all_assets"
                        ? "Remaining Estate Value"
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
                            <p className="text-sm text-gray-300">
                              {b.percentage}% of {assetLabel}
                            </p>
                            <p className="mt-1 text-xs text-gray-400">
                              {CONDITION_LABEL[b.condition]}
                            </p>
                            <p className="mt-1 text-xs text-gray-300">
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
                <h3 className="text-sm font-medium text-gray-300">Debt bequests</h3>
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
                <p className="text-sm text-gray-400">No debt bequests yet.</p>
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
                              <p className="text-sm text-gray-300">
                                Balance: ${liab.balance.toLocaleString()}
                              </p>
                            )}
                            <p className="mt-1 text-xs text-gray-300">
                              {b.recipients
                                .map(
                                  (r) =>
                                    `${recipientLabel(r, familyMembers, externalBeneficiaries, entities, primary)} (${r.percentage}%)`,
                                )
                                .join(", ")}
                              {isPartial && (
                                <span className="ml-1 text-gray-400">
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
      <BequestDialog
        open={assetModalOpen != null}
        onOpenChange={(open) => {
          if (!open) {
            setAssetModalOpen(null);
            setEditingIndex(null);
          }
        }}
        primary={primary}
        accounts={accounts}
        familyMembers={familyMembers}
        externalBeneficiaries={externalBeneficiaries}
        entities={entities}
        editing={editingIndex != null ? assetDraft : undefined}
        saving={saving}
        onSave={async (draft: BequestDraft) => {
          if (!assetModalOpen) return;
          const g = assetModalOpen;
          const existing = wills.find((w) => w.grantor === g)?.bequests ?? [];
          const assetBequest: WillsPanelAssetBequest = { kind: "asset", ...draft };
          const next: WillsPanelBequest[] = editingIndex != null
            ? existing.map((b, i) =>
                i === editingIndex
                  ? { ...assetBequest, sortOrder: i, id: b.id }
                  : b,
              )
            : [...existing, { ...assetBequest, sortOrder: existing.length }];
          await saveWill(g, next);
          setAssetModalOpen(null);
          setEditingIndex(null);
        }}
      />

      {/* Debt bequest modal */}
      <DebtBequestDialog
        open={debtModalOpen != null}
        onOpenChange={(open) => {
          if (!open) {
            setDebtModalOpen(null);
            setEditingIndex(null);
          }
        }}
        draft={liabilityDraft}
        setDraft={setLiabilityDraft}
        liabilities={liabilities}
        alreadyBequeathedIds={
          (wills.find((w) => w.grantor === debtModalOpen)?.bequests ?? []).flatMap(
            (b) => (b.kind === "liability" && b.liabilityId ? [b.liabilityId] : []),
          )
        }
        primary={primary}
        familyMembers={familyMembers}
        externalBeneficiaries={externalBeneficiaries}
        entities={entities}
        isEdit={editingIndex != null}
        saving={saving}
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

    </div>
  );
}
