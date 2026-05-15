"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import { deriveIsIrrevocable, type TrustSubType } from "@/lib/entities/trust";
import type { Designation, Entity, ExternalBeneficiary, FamilyMember } from "../family-view";
import BeneficiaryRowList, { type BeneficiaryRow } from "./beneficiary-row-list";
import TrustEndsSelect, { type TrustEnds } from "./trust-ends-select";
import { CurrencyInput } from "../currency-input";
import { PercentInput } from "../percent-input";
import { inputClassName, selectClassName, textareaClassName, fieldLabelClassName } from "./input-styles";
import AssetsTab, { type AssetsTabAccount, type AssetsTabLiability, type AssetsTabIncome, type AssetsTabExpense, type AssetsTabFamilyMember } from "./assets-tab";
import FlowsTab, {
  type FlowsTabIncome,
  type FlowsTabExpense,
  type ScheduleSaveBinding,
} from "./flows-tab";
import { applyAssetTabOp } from "./asset-tab-ops";
import type { AssetTabOp } from "./asset-tab-ops";
import TransfersTab, { type TransferEvent, type TransferSeries } from "./transfers-tab";
import TransferAssetForm, { type AccountOption as AssetAccountOption } from "./transfer-asset-form";
import TransferCashForm from "./transfer-cash-form";
import TransferSeriesForm from "./transfer-series-form";
import DialogShell from "../dialog-shell";
import ClutDetailsSection from "./clut-details-section";
import type { TrustSplitInterestInput } from "@/lib/schemas/trust-split-interest";
import {
  diffClutFundingPicks,
  type ClutFundingPick,
} from "@/lib/forms/clut-funding-diff";
import type { ClutFundingPickerAccount } from "./clut-funding-picker";
import { RETIREMENT_SUBTYPES } from "@/lib/ownership";

interface AddTrustFormProps {
  clientId: string;
  editing?: Entity;
  household: { client: { firstName: string }; spouse: { firstName: string } | null };
  members: FamilyMember[];
  externals: ExternalBeneficiary[];
  entities: { id: string; name: string }[];  // for remainder picker
  initialDesignations?: Designation[];        // pre-loaded for edit mode
  activeTab: "details" | "flows" | "assets" | "transfers" | "notes";
  /** Assets tab data — when absent the tab degrades gracefully */
  accounts?: AssetsTabAccount[];
  liabilities?: AssetsTabLiability[];
  incomes?: AssetsTabIncome[];
  expenses?: AssetsTabExpense[];
  /** Flows tab — single income + expense scoped to this entity. */
  entityIncome?: FlowsTabIncome | null;
  entityExpense?: FlowsTabExpense | null;
  assetFamilyMembers?: AssetsTabFamilyMember[];
  /** Schedule modal props */
  planEndYear?: number;
  primaryClientBirthYear?: number;
  initialFlowOverrides?: Array<{
    year: number;
    incomeAmount: number | null;
    expenseAmount: number | null;
    distributionPercent: number | null;
  }>;
  onSaved: (entity: Entity, mode: "create" | "edit") => void;
  onClose: () => void;
  onSubmitStateChange?: (state: { canSubmit: boolean; loading: boolean }) => void;
  /** Forwarded to FlowsTab → FlowScheduleGrid so the dialog footer can render a Save button. */
  onScheduleSaveBindingChange?: (binding: ScheduleSaveBinding | null) => void;
}

// ── Fetch helper ─────────────────────────────────────────────────────────────

/** Fetch JSON, throwing on non-2xx responses with the server's error message. */
async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error((j as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Trust type labels ─────────────────────────────────────────────────────────

const TRUST_TYPE_LABELS: Record<TrustSubType, string> = {
  revocable: "Revocable",
  irrevocable: "Irrevocable (generic)",
  ilit: "ILIT",
  slat: "SLAT",
  crt: "CRT",
  grat: "GRAT",
  qprt: "QPRT",
  clat: "CLAT",
  clut: "CLUT (Charitable Lead Unitrust)",
  qtip: "QTIP",
  bypass: "Bypass / Credit Shelter",
};

function ownerSummary(owners: import("@/engine/ownership").AccountOwner[]): string {
  if (owners.length === 1) {
    const o = owners[0];
    const pct = Math.round((o.percent ?? 1) * 100);
    if (o.kind === "family_member") return `Family ${pct}%`;
    return `Entity ${pct}%`;
  }
  return `${owners.length} owners`;
}

export default function AddTrustForm({
  clientId, editing, household, members, externals, entities,
  initialDesignations, activeTab, accounts, liabilities, incomes, expenses,
  entityIncome, entityExpense,
  assetFamilyMembers,
  planEndYear,
  primaryClientBirthYear,
  initialFlowOverrides,
  onSaved, onClose, onSubmitStateChange,
  onScheduleSaveBindingChange,
}: AddTrustFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => onSubmitStateChange?.({ canSubmit: !loading, loading }), [loading, onSubmitStateChange]);
  const scenarioWriter = useScenarioWriter(clientId);

  // Form state — create-mode defaults follow the most-common shape:
  //   * irrevocable trust (revocable trusts are typically already wired to the
  //     household and don't need separate planning)
  //   * survivorship (trust ends at the second death)
  //   * a placeholder name the advisor types over immediately on first focus
  const isCreate = !editing;
  const [name, setName] = useState(editing?.name ?? "New Trust");
  const [trustSubType, setTrustSubType] = useState<TrustSubType | "">(
    editing?.trustSubType ?? (isCreate ? "irrevocable" : "")
  );
  const [trustee, setTrustee] = useState(editing?.trustee ?? "");
  const [grantor, setGrantor] = useState<"client" | "spouse" | "">(editing?.grantor ?? "");
  const [trustEnds, setTrustEnds] = useState<TrustEnds | null>(
    (editing as Entity & { trustEnds?: TrustEnds | null })?.trustEnds ?? (isCreate ? "survivorship" : null)
  );

  // Auto-focus + select-all the name field on create so the advisor can replace
  // the "New Trust" placeholder by just typing.
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!isCreate) return;
    const el = nameInputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [isCreate]);
  const [includeInPortfolio, setIncludeInPortfolio] = useState(editing?.includeInPortfolio ?? false);
  const [accessibleToClient, setAccessibleToClient] = useState(
    (editing as { accessibleToClient?: boolean } | null)?.accessibleToClient ?? false,
  );
  const [isGrantor, setIsGrantor] = useState(editing?.isGrantor ?? false);
  const [notes, setNotes] = useState(editing?.notes ?? "");

  // Distribution policy
  const [distributionMode, setDistributionMode] = useState<"fixed" | "pct_liquid" | "pct_income" | null>(editing?.distributionMode ?? null);
  const [distributionAmount, setDistributionAmount] = useState(editing?.distributionAmount != null ? String(editing.distributionAmount) : "");
  const [distributionPercent, setDistributionPercent] = useState(() => {
    const raw = editing?.distributionPercent;
    return raw != null ? (Number(raw) * 100).toFixed(2) : "";
  });

  // Beneficiary rows — built from initialDesignations
  const [incomeRows, setIncomeRows] = useState<BeneficiaryRow[]>(() => designationsToRows(initialDesignations ?? [], "income"));
  const [remainderRows, setRemainderRows] = useState<BeneficiaryRow[]>(() => designationsToRows(initialDesignations ?? [], "remainder"));

  const isIrrevocable = trustSubType !== "" && deriveIsIrrevocable(trustSubType);
  // For CLUTs, distribution to the income beneficiary (charity) is computed
  // from payoutPercent × FMV, and the charity is captured in CLUT Details —
  // so the generic Distribution Policy + Income Beneficiaries panels are
  // suppressed entirely.
  const isClut = trustSubType === "clut";
  const showDistributionAndIncome = isIrrevocable && !isClut;

  // CLUT split-interest state. Initialized lazily so re-renders don't reset.
  const [splitInterest, setSplitInterest] = useState<TrustSplitInterestInput>(() => ({
    origin: "new",
    inceptionYear: new Date().getFullYear(),
    inceptionValue: 0,
    payoutType: "unitrust",
    payoutPercent: 0.06,
    irc7520Rate: 0.05,
    termType: "years",
    termYears: 10,
    charityId: "",
  }));

  // Picks for the CLUT funding-year FMV dropdown. Seeded from inception-year asset/cash transfers when editing.
  const [clutFundingPicks, setClutFundingPicks] = useState<ClutFundingPick[]>([]);
  const [originalClutFundingPicks, setOriginalClutFundingPicks] = useState<ClutFundingPick[]>([]);

  // ── Transfers tab state ────────────────────────────────────────────────────
  const [openModal, setOpenModal] = useState<"asset" | "cash" | "series" | null>(null);
  const [transferEvents, setTransferEvents] = useState<TransferEvent[]>([]);
  const [transferSeries, setTransferSeries] = useState<TransferSeries[]>([]);
  const [transferFetchError, setTransferFetchError] = useState<string | null>(null);
  // refetchTick is bumped after a successful save so the useEffect re-runs.
  const [refetchTick, setRefetchTick] = useState(0);

  // Self-fetch gifts and gift_series when the Transfers tab is active.
  // Mirrors the pattern used in beneficiaries-tab.tsx (per-account self-fetch on mount).
  // Fetches ALL gifts for the client then filters to this trust on the client side.
  useEffect(() => {
    // Fetch when editing any trust (Transfers tab is the obvious consumer; Details
    // tab also needs inception-year gifts for the CLUT funding picker).
    if (!editing) return;
    // Skip the fetch on Details tab for non-CLUT trusts to avoid the network hit.
    const needsGifts = activeTab === "transfers" || trustSubType === "clut";
    if (!needsGifts) return;
    let alive = true;
    setTransferFetchError(null);
    Promise.all([
      fetchJson<GiftRow[]>(`/api/clients/${clientId}/gifts`),
      fetchJson<GiftSeriesRow[]>(`/api/clients/${clientId}/gifts/series`),
    ]).then(([allGifts, allSeries]) => {
      if (!alive) return;
      setTransferEvents(toTransferEvents(allGifts, editing.id, accounts ?? [], liabilities ?? []));
      setTransferSeries(toTransferSeries(allSeries, editing.id));
    }).catch((err: Error) => {
      if (!alive) return;
      console.error("[transfers-tab] fetch failed:", err);
      setTransferFetchError(err.message);
    });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, editing?.id, clientId, refetchTick, accounts, liabilities, trustSubType]);

  // Seed CLUT funding picks from transferEvents at the inception year.
  // Re-runs when the inception year changes or when transferEvents reload.
  useEffect(() => {
    if (trustSubType !== "clut") return;
    if (splitInterest.origin !== "new") return;
    if (!editing) return; // create mode has no fetched gifts to seed from
    const year = splitInterest.inceptionYear;
    const seeded: ClutFundingPick[] = [];
    for (const ev of transferEvents) {
      if (ev.year !== year) continue;
      if (ev.kind === "asset") {
        // transferEvents only carry accountName, so we look up by name in the accounts prop.
        // Fragile if two accounts share a name — tracked as future work.
        const acct = (accounts ?? []).find((a) => a.name === ev.accountName);
        if (!acct) continue;
        seeded.push({
          kind: "asset",
          accountId: acct.id,
          percent: ev.percent,
          existingGiftId: ev.id,
        });
      } else if (ev.kind === "cash") {
        seeded.push({
          kind: "cash",
          grantor: ev.grantor,
          amount: ev.amount,
          existingGiftId: ev.id,
        });
      }
      // liability_only: not in scope — left on the Transfers tab.
    }
    setClutFundingPicks(seeded);
    setOriginalClutFundingPicks(seeded);
  }, [trustSubType, splitInterest.origin, splitInterest.inceptionYear, transferEvents, accounts, editing]);

  const fundingAccounts = useMemo<ClutFundingPickerAccount[]>(() => {
    if (trustSubType !== "clut") return [];
    const trustId = editing?.id;
    return (accounts ?? [])
      .filter((a) => {
        if (a.subType && (RETIREMENT_SUBTYPES as readonly string[]).includes(a.subType)) return false;
        if (a.isDefaultChecking) return false;
        if (trustId) {
          const trustOwn = a.owners.find(
            (o) => o.kind === "entity" && o.entityId === trustId,
          );
          if (trustOwn && (trustOwn.percent ?? 0) >= 1) return false;
        }
        const pinnedToOther = a.owners.some(
          (o) =>
            o.kind === "entity" &&
            o.entityId !== trustId &&
            (o.percent ?? 0) > 0,
        );
        if (pinnedToOther) return false;
        return true;
      })
      .map((a) => ({
        id: a.id,
        name: a.name,
        subType: a.subType,
        ownerSummary: ownerSummary(a.owners),
        value: a.value,
      }));
  }, [accounts, trustSubType, editing?.id]);

  // Sync splitInterest.inceptionValue to Σ(asset.value × pct) + Σ(cash.amount) whenever picks change.
  useEffect(() => {
    if (trustSubType !== "clut") return;
    if (splitInterest.origin !== "new") return;
    const total = clutFundingPicks.reduce((sum, p) => {
      if (p.kind === "asset") {
        const acct = fundingAccounts.find((a) => a.id === p.accountId);
        if (!acct) return sum;
        return sum + acct.value * p.percent;
      }
      return sum + p.amount;
    }, 0);
    if (total !== splitInterest.inceptionValue) {
      setSplitInterest((prev) => ({ ...prev, inceptionValue: total }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clutFundingPicks, fundingAccounts, trustSubType, splitInterest.origin]);

  // ── Asset tab op handler ───────────────────────────────────────────────────
  const handleAssetTabOp = useCallback(async (op: AssetTabOp) => {
    if (!editing) return; // no trust id in create mode — shouldn't be reachable
    const ctx = {
      entityId: editing.id,
      familyMembers: (assetFamilyMembers ?? []).map((m) => ({ id: m.id, role: m.role })),
    };

    const assetType = op.assetType;
    const assetId = op.assetId;

    // Find the current owners for this asset
    const currentItem =
      assetType === "account"
        ? (accounts ?? []).find((a) => a.id === assetId)
        : (liabilities ?? []).find((l) => l.id === assetId);

    if (!currentItem && op.type !== "add") return;
    const currentOwners = currentItem?.owners ?? [];

    // I5: wrap applyAssetTabOp — it can throw on invariant violations
    let newOwners: import("@/engine/ownership").AccountOwner[];
    try {
      newOwners = applyAssetTabOp(currentOwners, op, ctx);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cannot apply this change");
      return;
    }

    const url =
      assetType === "account"
        ? `/api/clients/${clientId}/accounts/${assetId}`
        : `/api/clients/${clientId}/liabilities/${assetId}`;

    // I2: route through scenario writer so scenario-mode edits go to the
    // unified changes route instead of mutating base-plan data directly.
    try {
      const res = await scenarioWriter.submit(
        {
          op: "edit",
          targetKind: assetType,
          targetId: assetId,
          desiredFields: { owners: newOwners },
        },
        {
          url,
          method: "PUT",
          body: { owners: newOwners },
        },
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(json.error ?? "Failed to update asset ownership");
        return;
      }
      // useScenarioWriter calls router.refresh() on success — no need to repeat here.
    } catch {
      setError("Failed to update asset ownership");
    }
  }, [editing, accounts, liabilities, assetFamilyMembers, clientId, scenarioWriter]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (trustSubType === "") {
      setError("Please pick a type.");
      return;
    }
    // Inline validation: distribution mode set ⇒ ≥1 income beneficiary
    if (distributionMode != null && incomeRows.filter((r) => r.source.kind !== "empty").length === 0) {
      setError("Distribution mode is set but no income beneficiaries are listed.");
      return;
    }

    if (trustSubType === "clut" && splitInterest.origin === "new") {
      if (clutFundingPicks.length === 0) {
        setError("Pick at least one funding asset or cash gift for the CLUT.");
        return;
      }
      const bad = clutFundingPicks.find(
        (p) => (p.kind === "asset" ? p.percent <= 0 : p.amount <= 0),
      );
      if (bad) {
        setError(
          bad.kind === "asset"
            ? "Asset picks must have a percent greater than 0."
            : "Cash picks must have an amount greater than 0.",
        );
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      // Save entity row first
      const entityBody = {
        name,
        entityType: "trust",
        notes: notes || null,
        includeInPortfolio,
        accessibleToClient,
        isGrantor,
        value: "0",
        owner: null,
        grantor: grantor || null,
        beneficiaries: [],  // legacy JSON column kept empty
        trustSubType: trustSubType as TrustSubType,
        isIrrevocable,
        trustee: trustee.trim() || null,
        trustEnds,
        distributionMode: showDistributionAndIncome ? distributionMode : null,
        distributionAmount: showDistributionAndIncome && distributionMode === "fixed" && distributionAmount.trim() !== "" ? Number(distributionAmount) : null,
        distributionPercent: showDistributionAndIncome && (distributionMode === "pct_liquid" || distributionMode === "pct_income") && distributionPercent.trim() !== "" ? Number(distributionPercent) / 100 : null,
        ...(trustSubType === "clut" && { splitInterest }),
      };
      const isEdit = Boolean(editing);
      const url = isEdit ? `/api/clients/${clientId}/entities/${editing!.id}` : `/api/clients/${clientId}/entities`;
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entityBody),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
      const saved = (await res.json()) as Entity;

      // Apply CLUT funding-pick changes as gift ops.
      if (trustSubType === "clut" && splitInterest.origin === "new") {
        const ops = diffClutFundingPicks({
          original: originalClutFundingPicks,
          current: clutFundingPicks,
          entityId: saved.id,
          year: splitInterest.inceptionYear,
          defaultAssetGrantor: grantor === "" ? "client" : grantor,
        });
        for (const op of ops) {
          if (op.type === "create") {
            const res = await fetch(`/api/clients/${clientId}/gifts`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(op.body),
            });
            if (!res.ok) {
              const j = (await res.json().catch(() => ({}))) as { error?: string };
              throw new Error(j.error ?? `Failed to create gift (HTTP ${res.status})`);
            }
          } else if (op.type === "update") {
            const res = await fetch(`/api/clients/${clientId}/gifts/${op.giftId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(op.body),
            });
            if (!res.ok) {
              const j = (await res.json().catch(() => ({}))) as { error?: string };
              throw new Error(j.error ?? `Failed to update gift (HTTP ${res.status})`);
            }
          } else {
            const res = await fetch(`/api/clients/${clientId}/gifts/${op.giftId}`, {
              method: "DELETE",
            });
            if (!res.ok) {
              const j = (await res.json().catch(() => ({}))) as { error?: string };
              throw new Error(j.error ?? `Failed to delete gift (HTTP ${res.status})`);
            }
          }
        }
      }

      // Save designations (income + remainder)
      const designations = [
        ...rowsToDesignationPayload(incomeRows, "income"),
        ...rowsToDesignationPayload(remainderRows, "remainder"),
      ];
      const desigRes = await fetch(`/api/clients/${clientId}/entities/${saved.id}/beneficiaries`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(designations),
      });
      if (!desigRes.ok) throw new Error((await desigRes.json()).error ?? "Failed to save beneficiaries");

      onSaved(saved, isEdit ? "edit" : "create");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form id="add-trust-form" onSubmit={handleSubmit} className="space-y-4">
      {error && <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>}

      <div className={activeTab !== "details" ? "hidden" : ""}>
        {/* Name */}
        <div>
          <label className={fieldLabelClassName} htmlFor="trust-name">Name <span className="text-red-500">*</span></label>
          <input
            ref={nameInputRef}
            id="trust-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Smith Family Trust"
            className={inputClassName}
          />
        </div>

        {/* Type + Trustee */}
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div>
            <label className={fieldLabelClassName} htmlFor="trust-type">Type <span className="text-red-500">*</span></label>
            <select id="trust-type" required value={trustSubType} onChange={(e) => setTrustSubType(e.target.value as TrustSubType | "")} className={selectClassName}>
              <option value="" disabled>— select type —</option>
              {Object.entries(TRUST_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className={fieldLabelClassName} htmlFor="trust-trustee">Trustee</label>
            <input id="trust-trustee" type="text" value={trustee} onChange={(e) => setTrustee(e.target.value)} placeholder="e.g., Linda, or Fidelity Trust Co." className={inputClassName} />
          </div>
        </div>

        {/* Grantor + Trust Ends */}
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div>
            <label className={fieldLabelClassName} htmlFor="trust-grantor">Grantor</label>
            <select id="trust-grantor" value={grantor} onChange={(e) => setGrantor(e.target.value as "client" | "spouse" | "")} className={selectClassName}>
              <option value="">Third party (none)</option>
              <option value="client">Client</option>
              <option value="spouse">Spouse</option>
            </select>
          </div>
          <div>
            <TrustEndsSelect household={household} value={trustEnds} onChange={setTrustEnds} id="trust-ends" />
          </div>
        </div>

        {/* Income Beneficiaries (hidden for revocable) */}
        {showDistributionAndIncome && (
          <div className="mt-4">
            <BeneficiaryRowList
              tier="income"
              allowEntities={false}
              rows={incomeRows}
              onChange={setIncomeRows}
              members={members}
              externals={externals}
              entities={[]}
              household={household}
            />
          </div>
        )}

        {/* Remainder Beneficiaries (always shown) */}
        <div className="mt-4">
          <BeneficiaryRowList
            tier="remainder"
            allowEntities={true}
            rows={remainderRows}
            onChange={setRemainderRows}
            members={members}
            externals={externals}
            entities={entities.filter((e) => e.id !== editing?.id)}
            household={household}
          />
        </div>

        {/* Distribution Policy (hidden for revocable) */}
        {showDistributionAndIncome && (
          <div className="mt-4 rounded-[var(--radius-sm)] border border-hair bg-card-2 p-3 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                Distribution Policy
              </span>
              <div className="flex gap-1 text-xs">
                {([
                  ["none", "None"],
                  ["fixed", "Fixed $"],
                  ["pct_liquid", "% liquid"],
                  ["pct_income", "% income"],
                ] as const).map(([val, label]) => {
                  const active = val === "none" ? distributionMode === null : distributionMode === val;
                  return (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setDistributionMode(val === "none" ? null : val)}
                      className={
                        "rounded-md border px-2 py-0.5 text-xs font-medium transition-colors " +
                        (active
                          ? "border-accent bg-accent/15 text-accent"
                          : "border-hair bg-card text-ink-3 hover:border-hair-2 hover:text-ink-2")
                      }
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            {distributionMode === "fixed" && (
              <div>
                <label className={fieldLabelClassName} htmlFor="dist-amount">Annual amount</label>
                <CurrencyInput id="dist-amount" value={distributionAmount} onChange={setDistributionAmount} />
              </div>
            )}
            {(distributionMode === "pct_liquid" || distributionMode === "pct_income") && (
              <div>
                <label className={fieldLabelClassName} htmlFor="dist-percent">Annual percent</label>
                <PercentInput id="dist-percent" value={distributionPercent} onChange={setDistributionPercent} />
              </div>
            )}
          </div>
        )}

        {trustSubType === "clut" && (
          <div className="mt-4">
            <ClutDetailsSection
              value={splitInterest}
              onChange={setSplitInterest}
              familyMembers={members.map((m) => ({
                id: m.id,
                firstName: m.firstName,
                dateOfBirth: m.dateOfBirth ?? null,
              }))}
              charities={externals
                .filter((e) => e.kind === "charity")
                .map((e) => ({ id: e.id, name: e.name }))}
              fundingAccounts={fundingAccounts}
              fundingPicks={clutFundingPicks}
              onFundingPicksChange={setClutFundingPicks}
              defaultGrantor={grantor === "" ? "client" : grantor}
            />
          </div>
        )}

        {/* Toggles */}
        <div className="mt-4 space-y-2">
          <label className="flex items-start gap-3 rounded-[var(--radius-sm)] border border-hair bg-card-2 p-3 cursor-pointer hover:border-hair-2">
            <input
              type="checkbox"
              checked={includeInPortfolio}
              onChange={(e) => setIncludeInPortfolio(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-hair bg-card text-accent focus:ring-1 focus:ring-accent/40"
            />
            <span className="text-sm text-ink-2">
              Include this entity&apos;s accounts in portfolio assets
              <span className="block text-xs text-ink-4">
                Trust-owned accounts contribute to liquid assets and projected returns.
              </span>
            </span>
          </label>
          {!includeInPortfolio && isIrrevocable && (
            <label className="flex items-start gap-3 rounded-[var(--radius-sm)] border border-hair bg-card-2 p-3 cursor-pointer hover:border-hair-2">
              <input
                type="checkbox"
                checked={accessibleToClient}
                onChange={(e) => setAccessibleToClient(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-hair bg-card text-accent focus:ring-1 focus:ring-accent/40"
              />
              <span className="text-sm text-ink-2">
                Client has a provision to access these assets
                <span className="block text-xs text-ink-4">
                  Surfaces this trust in the &ldquo;Accessible Trust Assets&rdquo; column on the cash-flow drill. Use for HEMS standards, trust-protector access, or distribution committees that let the client withdraw.
                </span>
              </span>
            </label>
          )}
          <label className="flex items-start gap-3 rounded-[var(--radius-sm)] border border-hair bg-card-2 p-3 cursor-pointer hover:border-hair-2">
            <input
              type="checkbox"
              checked={isGrantor}
              onChange={(e) => setIsGrantor(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-hair bg-card text-accent focus:ring-1 focus:ring-accent/40"
            />
            <span className="text-sm text-ink-2">
              Income taxes paid by household (grantor trust)
              <span className="block text-xs text-ink-4">
                Trust income flows to the grantor&apos;s 1040 — household pays tax instead of the trust.
              </span>
            </span>
          </label>
        </div>
      </div>

      <div className={activeTab !== "assets" ? "hidden" : ""}>
        {editing && accounts !== undefined ? (
          <AssetsTab
            entityId={editing.id}
            accounts={accounts ?? []}
            liabilities={liabilities ?? []}
            incomes={incomes ?? []}
            expenses={expenses ?? []}
            familyMembers={assetFamilyMembers ?? []}
            entities={entities}
            entityLabel="trust"
            onChange={handleAssetTabOp}
          />
        ) : (
          <p className="text-[13px] text-ink-3 text-center py-6">
            Asset management is available when editing an existing trust from the Estate Planning page.
          </p>
        )}
      </div>

      <div className={activeTab !== "flows" ? "hidden" : ""}>
        {editing ? (
          <FlowsTab
            clientId={clientId}
            entityId={editing.id}
            entityName={editing.name}
            entityType="trust"
            income={entityIncome ?? null}
            expense={entityExpense ?? null}
            distributionPolicyPercent={null /* trusts don't use this in P1 */}
            taxTreatment={editing.taxTreatment ?? "ordinary"}
            flowMode={editing.flowMode ?? "annual"}
            planStartYear={new Date().getFullYear()}
            defaultEndYear={planEndYear ?? new Date().getFullYear() + 30}
            planEndYear={planEndYear ?? new Date().getFullYear() + 30}
            primaryClientBirthYear={primaryClientBirthYear ?? new Date().getFullYear() - 55}
            initialFlowOverrides={initialFlowOverrides ?? []}
            onScheduleSaveBindingChange={onScheduleSaveBindingChange}
          />
        ) : (
          <p className="text-[13px] text-ink-3 text-center py-6">
            Flows are available when editing an existing trust.
          </p>
        )}
      </div>

      <div className={activeTab !== "transfers" ? "hidden" : ""}>
        {editing ? (
          <>
            {transferFetchError && (
              <div role="alert" className="text-xs text-red-400 mb-2">
                Couldn&apos;t load transfers: {transferFetchError}
              </div>
            )}
            <TransfersTab
              events={transferEvents}
              series={transferSeries}
              // T21 scope: exemption + total-consumed are deferred.
              // See future-work/estate.md — needs compute-ledger integration.
              exemption={{}}
              totalConsumedByThisTrust={{ client: 0, spouse: 0 }}
              onAdd={(kind) => setOpenModal(kind)}
              // onEdit intentionally omitted — edit mode not yet implemented.
              // Each modal form needs an `editing` prop and a PATCH path.
              // Tracked in future-work/estate.md.
              onDelete={async (item) => {
                const isSeries = "annualAmount" in item;
                const url = isSeries
                  ? `/api/clients/${clientId}/gifts/series/${item.id}`
                  : `/api/clients/${clientId}/gifts/${item.id}`;
                try {
                  const res = await fetch(url, { method: "DELETE" });
                  if (!res.ok) {
                    const j = await res.json().catch(() => ({}));
                    throw new Error((j as { error?: string }).error ?? `HTTP ${res.status}`);
                  }
                  if (isSeries) {
                    setTransferSeries((prev) => prev.filter((s) => s.id !== item.id));
                  } else {
                    setTransferEvents((prev) => prev.filter((e) => e.id !== item.id));
                  }
                } catch (err) {
                  console.error("[transfers-tab] delete failed:", err);
                  setTransferFetchError(err instanceof Error ? err.message : "Delete failed");
                }
              }}
            />
          </>
        ) : (
          <p className="text-[13px] text-ink-3 text-center py-6">
            Transfer management is available when editing an existing trust.
          </p>
        )}
      </div>

      <div className={activeTab !== "notes" ? "hidden" : ""}>
        <label className={fieldLabelClassName} htmlFor="trust-notes">Notes</label>
        <textarea id="trust-notes" rows={8} value={notes} onChange={(e) => setNotes(e.target.value)} className={textareaClassName} />
      </div>

      {/* ── Transfer modals ─────────────────────────────────────────────────── */}
      {editing && openModal === "asset" && (
        <DialogShell
          open
          onOpenChange={() => setOpenModal(null)}
          title="Asset Transfer"
          size="md"
        >
          <TransferAssetForm
            clientId={clientId}
            trustId={editing.id}
            // T21 scope: trustGrantor defaults to grantor field or "client".
            // Proper derivation tracked in future-work/estate.md.
            trustGrantor={(grantor as "client" | "spouse") || "client"}
            accounts={toAssetAccountOptions(accounts ?? [], editing.id)}
            currentYear={new Date().getFullYear()}
            projectionStartYear={new Date().getFullYear()}
            onClose={() => setOpenModal(null)}
            onSaved={() => {
              setOpenModal(null);
              // Trigger refetch by bumping a version counter
              setRefetchTick((t) => t + 1);
            }}
          />
        </DialogShell>
      )}

      {editing && openModal === "cash" && (
        <DialogShell
          open
          onOpenChange={() => setOpenModal(null)}
          title="Cash Gift"
          size="md"
        >
          <TransferCashForm
            clientId={clientId}
            trustId={editing.id}
            trustGrantor={(grantor as "client" | "spouse") || "client"}
            accounts={toBasicAccountOptions(accounts ?? [])}
            currentYear={new Date().getFullYear()}
            onClose={() => setOpenModal(null)}
            onSaved={() => {
              setOpenModal(null);
              setRefetchTick((t) => t + 1);
            }}
          />
        </DialogShell>
      )}

      {editing && openModal === "series" && (
        <DialogShell
          open
          onOpenChange={() => setOpenModal(null)}
          title="Recurring Gift Series"
          size="md"
        >
          <TransferSeriesForm
            clientId={clientId}
            trustId={editing.id}
            trustGrantor={(grantor as "client" | "spouse") || "client"}
            accounts={toBasicAccountOptions(accounts ?? [])}
            currentYear={new Date().getFullYear()}
            onClose={() => setOpenModal(null)}
            onSaved={() => {
              setOpenModal(null);
              setRefetchTick((t) => t + 1);
            }}
          />
        </DialogShell>
      )}
    </form>
  );
}

// ── Raw API row shapes (minimal — only the fields we read) ───────────────────

interface GiftRow {
  id: string;
  year: number;
  amount: string | null;
  grantor: "client" | "spouse" | "joint";
  recipientEntityId: string | null;
  accountId: string | null;
  liabilityId: string | null;
  percent: string | null;
  parentGiftId: string | null;
  useCrummeyPowers: boolean;
  notes: string | null;
}

interface GiftSeriesRow {
  id: string;
  grantor: "client" | "spouse" | "joint";
  recipientEntityId: string;
  startYear: number;
  endYear: number;
  annualAmount: string;
  inflationAdjust: boolean;
  useCrummeyPowers: boolean;
}

// ── Transfer mappers ─────────────────────────────────────────────────────────

/**
 * Map raw gift rows to TransferEvent discriminated union rows.
 *
 * Rules (matching how the API creates gift rows):
 * - accountId != null && parentGiftId == null  → kind="asset" (main asset row)
 * - liabilityId != null && parentGiftId != null → skip (auto-bundled child of asset)
 * - liabilityId != null && parentGiftId == null → kind="liability_only"
 * - everything else (no accountId, no liabilityId) → kind="cash"
 */
function toTransferEvents(
  all: GiftRow[],
  trustId: string,
  assetsTabAccounts: AssetsTabAccount[],
  // liabilities reserved for future display of transferred liability balances
  _assetsTabLiabilities: AssetsTabLiability[],
): TransferEvent[] {
  const forTrust = all.filter((g) => g.recipientEntityId === trustId);
  // Build a map of parentGiftId → child rows (for bundled liabilities)
  const childrenByParent = new Map<string, GiftRow[]>();
  for (const g of forTrust) {
    if (g.parentGiftId) {
      const arr = childrenByParent.get(g.parentGiftId) ?? [];
      arr.push(g);
      childrenByParent.set(g.parentGiftId, arr);
    }
  }

  const results: TransferEvent[] = [];
  for (const g of forTrust) {
    // Skip auto-bundled liability children — they are displayed as sub-rows of asset rows.
    if (g.liabilityId && g.parentGiftId) continue;

    if (g.accountId && !g.parentGiftId) {
      // Asset transfer row
      const account = assetsTabAccounts.find((a) => a.id === g.accountId);
      const pct = g.percent != null ? Number(g.percent) : 0;
      // Look for a bundled liability child
      const bundledChild = childrenByParent.get(g.id)?.[0];
      const event: TransferEvent = {
        kind: "asset",
        id: g.id,
        year: g.year,
        accountName: account?.name ?? g.accountId,
        percent: pct,
        value: account != null
          ? account.value * pct
          : 0,
        grantor: g.grantor === "joint" ? "client" : g.grantor,
        bundledLiability: bundledChild
          ? {
              name: bundledChild.notes ?? "Linked liability",
              value: 0, // balance not available in gifts row; display only
              percent: pct,
            }
          : undefined,
      };
      results.push(event);
    } else if (g.liabilityId && !g.parentGiftId) {
      // Standalone liability-only transfer
      const pct = g.percent != null ? Number(g.percent) : 0;
      results.push({
        kind: "liability_only",
        id: g.id,
        year: g.year,
        liabilityName: g.notes ?? g.liabilityId,
        percent: pct,
        value: 0,
        grantor: g.grantor === "joint" ? "client" : g.grantor,
      });
    } else {
      // Cash gift
      results.push({
        kind: "cash",
        id: g.id,
        year: g.year,
        amount: g.amount != null ? Number(g.amount) : 0,
        grantor: g.grantor === "joint" ? "client" : g.grantor,
        useCrummeyPowers: g.useCrummeyPowers,
        notes: g.notes ?? undefined,
      });
    }
  }
  return results;
}

/** Map raw gift_series rows for this trust to TransferSeries display shape. */
function toTransferSeries(all: GiftSeriesRow[], trustId: string): TransferSeries[] {
  return all
    .filter((s) => s.recipientEntityId === trustId)
    .map((s) => ({
      id: s.id,
      startYear: s.startYear,
      endYear: s.endYear,
      annualAmount: Number(s.annualAmount),
      inflationAdjust: s.inflationAdjust,
      useCrummeyPowers: s.useCrummeyPowers,
      grantor: s.grantor === "joint" ? "client" : s.grantor,
    }));
}

/**
 * Adapt AssetsTabAccount[] to the AccountOption shape expected by TransferAssetForm.
 * Fields without a direct equivalent are defaulted conservatively.
 */
function toAssetAccountOptions(
  accounts: AssetsTabAccount[],
  trustId: string,
): AssetAccountOption[] {
  return accounts.map((a) => {
    // Compute trustPercent: fraction of the account currently owned by this trust
    const trustOwner = a.owners.find(
      (o) => o.kind === "entity" && o.entityId === trustId
    );
    const trustPercent = trustOwner?.percent ?? 0;
    // Determine if this account is pinned to a different entity (not this trust)
    const ownedByOtherEntity = a.owners.some(
      (o) => o.kind === "entity" && o.entityId !== trustId && (o.percent ?? 0) > 0
    );
    return {
      id: a.id,
      name: a.name,
      value: a.value,
      growthRate: 0, // AssetsTabAccount doesn't carry growthRate — transfer form uses it for preview only
      subType: a.subType ?? "investment",
      isDefaultChecking: a.isDefaultChecking ?? false,
      ownerSummary: a.owners
        .map((o) =>
          o.kind === "family_member"
            ? `${o.familyMemberId.slice(0, 6)} ${Math.round((o.percent ?? 0) * 100)}%`
            : `entity ${Math.round((o.percent ?? 0) * 100)}%`
        )
        .join(" / "),
      trustPercent,
      ownedByOtherEntity,
      linkedLiability: undefined,
    };
  });
}

/**
 * Minimal account option shape used by TransferCashForm and TransferSeriesForm.
 * For the richer shape required by TransferAssetForm use toAssetAccountOptions().
 */
function toBasicAccountOptions(
  accounts: AssetsTabAccount[],
): { id: string; name: string; isDefaultChecking: boolean }[] {
  return accounts.map((a) => ({
    id: a.id,
    name: a.name,
    isDefaultChecking: a.isDefaultChecking ?? false,
  }));
}

// ── Designation helpers ───────────────────────────────────────────────────────

function designationsToRows(d: Designation[], tier: "income" | "remainder"): BeneficiaryRow[] {
  return d
    .filter((x) => x.tier === tier)
    .map((x) => ({
      id: x.id,
      source: designationToSource(x),
      percentage: x.percentage,
      ...(tier === "remainder"
        ? { distributionForm: (x.distributionForm ?? "outright") as "in_trust" | "outright" }
        : {}),
    }));
}

function designationToSource(d: Designation): BeneficiaryRow["source"] {
  if (d.familyMemberId) return { kind: "family", familyMemberId: d.familyMemberId };
  if (d.externalBeneficiaryId) return { kind: "external", externalBeneficiaryId: d.externalBeneficiaryId };
  if (d.entityIdRef) return { kind: "entity", entityId: d.entityIdRef };
  if (d.householdRole) return { kind: "household", role: d.householdRole };
  return { kind: "empty" };
}

function rowsToDesignationPayload(rows: BeneficiaryRow[], tier: "income" | "remainder") {
  return rows
    .filter((r) => r.source.kind !== "empty")
    .map((r, idx) => {
      const base = {
        tier,
        percentage: r.percentage,
        sortOrder: idx,
        ...(tier === "remainder"
          ? { distributionForm: r.distributionForm ?? "outright" }
          : {}),
      };
      switch (r.source.kind) {
        case "household": return { ...base, householdRole: r.source.role };
        case "family": return { ...base, familyMemberId: r.source.familyMemberId };
        case "external": return { ...base, externalBeneficiaryId: r.source.externalBeneficiaryId };
        case "entity": return { ...base, entityIdRef: r.source.entityId };
        default: return base;
      }
    });
}
