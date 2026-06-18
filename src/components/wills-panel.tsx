"use client";

import { useEffect, useMemo, useState } from "react";
import BequestDialog, { type BequestDraft } from "@/components/bequest-dialog";
import WillResiduarySection from "@/components/forms/will-residuary-section";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import { useClientAccess } from "@/components/client-access-provider";
// Local copy — `BUSINESS_ENTITY_TYPES` was removed from `in-estate-weights.ts`
// in the business-as-asset migration. This UI is being phased out separately;
// keep the gate inline until then.
const BUSINESS_ENTITY_TYPES = new Set([
  "llc",
  "s_corp",
  "c_corp",
  "partnership",
  "other",
]);

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
  tier?: "primary" | "contingent";
  percentage: number;
  sortOrder: number;
}

export interface WillsPanelAssetBequest {
  kind: "asset";
  id?: string;
  name: string;
  assetMode: WillAssetMode;
  accountId: string | null;
  entityId?: string | null;
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
  residuaryRecipients?: WillsPanelRecipient[];
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
  /** Set when the account is 100%-owned by a single entity (business or trust).
   *  Such accounts are hidden from the bequest picker — a business entity is
   *  bequeathed as a whole (its cash/assets ride along), and trust assets
   *  aren't part of the grantor's bequeathable estate. */
  ownerEntityId?: string | null;
  /** Current market value. Shown alongside the name in the bequest picker. */
  value?: number;
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
  /** Role on the family table; "client" / "spouse" rows are hidden from the
   *  recipient dropdowns since the will's grantor doesn't bequeath to
   *  themselves and the spouse already appears under "Household". */
  role?: "client" | "spouse" | "child" | "other";
}

export interface WillsPanelExternal {
  id: string;
  name: string;
}

export interface WillsPanelEntity {
  id: string;
  name: string;
  entityType?: string;
  /** Business entities: equity value + value of all accounts the entity owns
   *  (its cash/assets ride along when the entity is bequeathed). Undefined
   *  for entities used only as recipients (charities, third-party trusts). */
  value?: number;
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
  /** Reserved seam for wizard-mode trimming. No structural change today since
   *  WillsPanel has no top-level h1 — the per-grantor h2's are appropriate
   *  inside the wizard. Kept so the step component stays uniform with
   *  Insurance/Assumptions. */
  embed?: "page" | "wizard";
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
  grantor: WillGrantor,
): string {
  if (r.recipientKind === "spouse") {
    const otherName = grantor === "client" ? p.spouseName : p.firstName;
    return `${otherName || "Spouse"} (spouse)`;
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

function bequestToDraft(b: WillsPanelBequest): BequestDraft {
  if (b.kind === "asset") {
    return {
      kind: "asset",
      name: b.name,
      assetMode: b.assetMode,
      accountId: b.accountId,
      entityId: b.entityId ?? null,
      percentage: b.percentage,
      condition: b.condition,
      sortOrder: b.sortOrder,
      recipients: b.recipients.map((r, i) => ({
        recipientKind: r.recipientKind,
        recipientId: r.recipientId,
        percentage: r.percentage,
        sortOrder: i,
      })),
    };
  }
  return {
    kind: "liability",
    name: b.name,
    liabilityId: b.liabilityId,
    percentage: b.percentage,
    condition: "always",
    sortOrder: b.sortOrder,
    recipients: b.recipients.map((r, i) => ({
      recipientKind: r.recipientKind,
      recipientId: r.recipientId,
      percentage: r.percentage,
      sortOrder: i,
    })),
  };
}

function draftToBequest(draft: BequestDraft): WillsPanelBequest {
  if (draft.kind === "asset") {
    return {
      kind: "asset",
      name: draft.name,
      assetMode: draft.assetMode,
      accountId: draft.accountId,
      entityId: draft.entityId,
      percentage: draft.percentage,
      condition: draft.condition,
      sortOrder: draft.sortOrder,
      recipients: draft.recipients,
    };
  }
  return {
    kind: "liability",
    name: draft.name,
    liabilityId: draft.liabilityId,
    percentage: draft.percentage,
    condition: "always",
    sortOrder: draft.sortOrder,
    recipients: draft.recipients,
  };
}

export default function WillsPanel(props: WillsPanelProps) {
  const { permission } = useClientAccess();
  const canEdit = permission === "edit";
  const {
    primary,
    initialWills,
    accounts,
    liabilities,
    familyMembers,
    externalBeneficiaries,
    entities,
  } = props;
  const businessEntities = useMemo(
    () => entities.filter((e) => e.entityType != null && BUSINESS_ENTITY_TYPES.has(e.entityType)),
    [entities],
  );
  const writer = useScenarioWriter(props.clientId);
  const [wills, setWills] = useState<WillsPanelWill[]>(initialWills);
  // When the page re-renders after `router.refresh()` (scenario writes do
  // this), `initialWills` reflects the new effective tree. Sync local state so
  // the UI doesn't show stale data from before the refresh.
  useEffect(() => {
    setWills(initialWills);
  }, [initialWills]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [dialogOpenFor, setDialogOpenFor] = useState<WillGrantor | null>(null);
  const [dialogEditing, setDialogEditing] = useState<BequestDraft | undefined>(undefined);

  async function fetchWill(willId: string): Promise<WillsPanelWill | null> {
    const res = await fetch(`/api/clients/${props.clientId}/wills/${willId}`);
    if (!res.ok) return null;
    return (await res.json()) as WillsPanelWill;
  }

  // Stamp UUIDs onto any new bequests so each scenario edit produces a stable
  // identity for downstream tooling (changes panel, toggle groups, audit). The
  // engine doesn't strictly require bequest ids, but the WillsPanel UI keys on
  // them when re-rendering after a save.
  function withStableIds(items: WillsPanelBequest[]): WillsPanelBequest[] {
    return items.map((b, i) => ({
      ...b,
      id: b.id ?? crypto.randomUUID(),
      sortOrder: i,
    }));
  }

  async function saveWillFull(
    g: WillGrantor,
    nextBequests: WillsPanelBequest[],
    nextResiduary: WillsPanelRecipient[],
  ) {
    setSaving(true);
    setError(null);
    try {
      const existing = wills.find((w) => w.grantor === g);

      if (writer.scenarioActive) {
        const stableBequests = withStableIds(nextBequests);
        if (!existing) {
          // Brand-new will: route through the scenario writer as an `add` op
          // carrying the full Will entity (including nested bequests). Base
          // tables stay untouched — the change lives in scenario_changes.
          const newWillId = crypto.randomUUID();
          const res = await writer.submit(
            {
              op: "add",
              targetKind: "will",
              entity: {
                id: newWillId,
                grantor: g,
                bequests: stableBequests,
                residuaryRecipients: nextResiduary,
              },
            },
            // Unused in scenario mode — kept satisfied for the writer's API.
            { url: "", method: "POST" },
          );
          if (!res.ok) throw new Error(`scenario add failed: HTTP ${res.status}`);
          setWills((prev) => [
            ...prev.filter((w) => w.grantor !== g),
            {
              id: newWillId,
              grantor: g,
              bequests: stableBequests,
              residuaryRecipients: nextResiduary,
            },
          ]);
        } else {
          // Existing will: edit the `bequests`/`residuaryRecipients` fields as
          // a fat-field overwrite. The engine's diff writer JSON-compares the
          // arrays against base; identical state collapses to a no-op revert.
          const res = await writer.submit(
            {
              op: "edit",
              targetKind: "will",
              targetId: existing.id,
              desiredFields: {
                bequests: stableBequests,
                residuaryRecipients: nextResiduary,
              },
            },
            { url: "", method: "PATCH" },
          );
          if (!res.ok) throw new Error(`scenario edit failed: HTTP ${res.status}`);
          setWills((prev) =>
            prev.map((w) =>
              w.grantor === g
                ? { ...w, bequests: stableBequests, residuaryRecipients: nextResiduary }
                : w,
            ),
          );
        }
        return;
      }

      // Base mode: legacy per-entity routes (unchanged).
      let willId: string;
      if (!existing) {
        const res = await fetch(`/api/clients/${props.clientId}/wills`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grantor: g,
            bequests: nextBequests,
            residuaryRecipients: nextResiduary,
          }),
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
            body: JSON.stringify({
              bequests: nextBequests,
              residuaryRecipients: nextResiduary,
            }),
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
          return [
            ...rest,
            {
              id: willId,
              grantor: g,
              bequests: nextBequests,
              residuaryRecipients: nextResiduary,
            },
          ];
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveWill(g: WillGrantor, nextBequests: WillsPanelBequest[]) {
    const existing = wills.find((w) => w.grantor === g);
    await saveWillFull(g, nextBequests, existing?.residuaryRecipients ?? []);
  }

  async function deleteWill(g: WillGrantor, willId: string) {
    setSaving(true);
    setError(null);
    try {
      if (writer.scenarioActive) {
        const res = await writer.submit(
          { op: "remove", targetKind: "will", targetId: willId },
          { url: "", method: "DELETE" },
        );
        if (!res.ok) throw new Error(`scenario remove failed: HTTP ${res.status}`);
      } else {
        const res = await fetch(
          `/api/clients/${props.clientId}/wills/${willId}`,
          { method: "DELETE" },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
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
        const bequests = will?.bequests ?? [];
        const alreadyBequeathedLiabilityIds = bequests.flatMap((b) =>
          b.kind === "liability" && b.liabilityId ? [b.liabilityId] : [],
        );

        return (
          <section key={g} className="rounded-lg border border-gray-800 bg-gray-900/40 p-5">
            <header className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-100">
                {heading}&apos;s Will
              </h2>
              {canEdit && (
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
                      setDialogEditing(undefined);
                      setEditingIndex(null);
                      setDialogOpenFor(g);
                    }}
                  >
                    + Add bequest
                  </button>
                </div>
              )}
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

            <div className="mb-4">
              <h3 className="mb-2 text-sm font-medium text-gray-300">Bequests</h3>
              {bequests.length === 0 ? (
                <p className="text-sm text-gray-400">No bequests yet.</p>
              ) : (
                <div className="overflow-hidden rounded-md border border-gray-800">
                  <div
                    role="row"
                    className="hidden grid-cols-[2.25rem_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-3 border-b border-gray-800 bg-gray-900/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 md:grid"
                  >
                    <span>#</span>
                    <span>Bequest</span>
                    <span>Detail</span>
                    <span>Recipients</span>
                    <span className="text-right">Actions</span>
                  </div>
                  <ol className="divide-y divide-gray-800">
                    {bequests.map((b, idx) => {
                      const isAsset = b.kind === "asset";
                      const tagLabel = isAsset ? "Asset" : "Debt";
                      const tagClass = isAsset
                        ? "border-emerald-800 bg-emerald-900/30 text-emerald-300"
                        : "border-amber-800 bg-amber-900/30 text-amber-300";

                      let detailNode: React.ReactNode = null;
                      let conditionNode: React.ReactNode = null;

                      if (isAsset) {
                        const assetLabel =
                          b.assetMode === "all_assets"
                            ? "Remaining Estate Value"
                            : b.entityId
                              ? (entities.find((e) => e.id === b.entityId)?.name ?? "(unknown entity)")
                              : (accounts.find((a) => a.id === b.accountId)?.name ?? "(unknown account)");
                        detailNode = (
                          <span className="text-sm text-gray-200">
                            {b.percentage}% of {assetLabel}
                          </span>
                        );
                        conditionNode = (
                          <span
                            title={CONDITION_LABEL[b.condition]}
                            className="mt-1 inline-block w-fit rounded border border-gray-700 bg-gray-800/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-300"
                          >
                            {CONDITION_LABEL[b.condition]}
                          </span>
                        );
                      } else {
                        const liab = liabilities.find((l) => l.id === b.liabilityId);
                        detailNode = liab ? (
                          <span className="text-sm text-gray-200">
                            ${liab.balance.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-sm text-gray-500">—</span>
                        );
                      }

                      const recipientSum = b.recipients.reduce((s, r) => s + r.percentage, 0);
                      const remainder = Math.round((100 - recipientSum) * 100) / 100;
                      const isPartialDebt = !isAsset && remainder > 0.009;
                      const recipientsText = b.recipients
                        .map(
                          (r) =>
                            `${recipientLabel(r, familyMembers, externalBeneficiaries, entities, primary, g)} (${r.percentage}%)`,
                        )
                        .join(", ");

                      return (
                        <li
                          key={b.id ?? `${b.kind}-${idx}`}
                          className="grid grid-cols-[2.25rem_minmax(0,1fr)] items-start gap-3 bg-gray-900/30 px-3 py-2.5 transition-colors hover:bg-gray-900/60 md:grid-cols-[2.25rem_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] md:items-center"
                        >
                          <span
                            aria-hidden
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-gray-700 bg-gray-800 text-xs font-semibold tabular-nums text-gray-300"
                          >
                            {idx + 1}
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tagClass}`}
                              >
                                {tagLabel}
                              </span>
                              <p className="truncate font-medium text-gray-100">{b.name}</p>
                            </div>
                          </div>
                          <div className="col-span-2 col-start-2 flex flex-col gap-1 md:col-span-1 md:col-start-auto">
                            {detailNode}
                            {conditionNode}
                          </div>
                          <p className="col-span-2 col-start-2 truncate text-xs text-gray-300 md:col-span-1 md:col-start-auto" title={recipientsText}>
                            {recipientsText}
                            {isPartialDebt && (
                              <span className="ml-1 text-gray-400">
                                · {remainder.toFixed(2)}% to estate creditor-payoff
                              </span>
                            )}
                          </p>
                          {canEdit && (
                            <div className="col-span-2 col-start-2 flex shrink-0 items-center justify-end gap-1 md:col-span-1 md:col-start-auto">
                              <button
                                type="button"
                                aria-label="Move up"
                                title="Move up"
                                disabled={idx === 0 || saving}
                                onClick={async () => {
                                  const next = [...bequests];
                                  const tmp = next[idx - 1];
                                  next[idx - 1] = { ...next[idx], sortOrder: idx - 1 };
                                  next[idx] = { ...tmp, sortOrder: idx };
                                  await saveWill(g, next);
                                }}
                                className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
                              >
                                <span aria-hidden className="block h-4 w-4 text-center text-xs leading-4">↑</span>
                              </button>
                              <button
                                type="button"
                                aria-label="Move down"
                                title="Move down"
                                disabled={idx === bequests.length - 1 || saving}
                                onClick={async () => {
                                  const next = [...bequests];
                                  const tmp = next[idx + 1];
                                  next[idx + 1] = { ...next[idx], sortOrder: idx + 1 };
                                  next[idx] = { ...tmp, sortOrder: idx };
                                  await saveWill(g, next);
                                }}
                                className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
                              >
                                <span aria-hidden className="block h-4 w-4 text-center text-xs leading-4">↓</span>
                              </button>
                              <button
                                type="button"
                                aria-label="Edit bequest"
                                title="Edit"
                                disabled={saving}
                                onClick={() => {
                                  setDialogEditing(bequestToDraft(b));
                                  setEditingIndex(idx);
                                  setDialogOpenFor(g);
                                }}
                                className="ml-1 rounded border border-gray-700 px-2 py-0.5 text-xs text-gray-200 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                aria-label="Delete bequest"
                                title="Delete"
                                disabled={saving}
                                onClick={async () => {
                                  const next = bequests
                                    .filter((_, i) => i !== idx)
                                    .map((x, i) => ({ ...x, sortOrder: i }));
                                  await saveWill(g, next);
                                }}
                                className="rounded p-1 text-white hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <span aria-hidden className="block h-4 w-4 text-center text-xs leading-4">✕</span>
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}
            </div>

            <WillResiduarySection
              rows={will?.residuaryRecipients ?? []}
              onChange={canEdit ? async (next) => {
                await saveWillFull(g, will?.bequests ?? [], next);
              } : undefined}
              grantor={g}
              primary={primary}
              familyMembers={familyMembers}
              externalBeneficiaries={externalBeneficiaries}
              entities={entities}
              saving={saving}
            />
            {/* Surface already-bequeathed liability ids so the editor disables them
                in the dropdown when this section's "Add bequest" is active. */}
            {canEdit && dialogOpenFor === g && (
              <BequestDialog
                open
                onOpenChange={(open) => {
                  if (!open) {
                    setDialogOpenFor(null);
                    setDialogEditing(undefined);
                    setEditingIndex(null);
                  }
                }}
                grantor={g}
                primary={primary}
                accounts={accounts}
                liabilities={liabilities}
                alreadyBequeathedLiabilityIds={alreadyBequeathedLiabilityIds}
                familyMembers={familyMembers}
                externalBeneficiaries={externalBeneficiaries}
                entities={entities}
                businessEntities={businessEntities}
                editing={dialogEditing}
                saving={saving}
                onSave={async (draft) => {
                  const existing = bequests;
                  const built = draftToBequest(draft);
                  let next: WillsPanelBequest[];
                  if (editingIndex != null) {
                    next = existing.map((b, i) =>
                      i === editingIndex
                        ? ({ ...built, sortOrder: i, id: b.id } as WillsPanelBequest)
                        : b,
                    );
                  } else {
                    next = [...existing, { ...built, sortOrder: existing.length }];
                  }
                  await saveWill(g, next);
                  setDialogOpenFor(null);
                  setDialogEditing(undefined);
                  setEditingIndex(null);
                }}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}
