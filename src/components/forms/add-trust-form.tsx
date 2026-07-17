"use client";

import { forwardRef, useImperativeHandle, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import { deriveIsIrrevocable, type TrustSubType } from "@/lib/entities/trust";
import { defaultIsGrantorFor } from "@/lib/trust-defaults";
import type { Designation, Entity, ExternalBeneficiary, FamilyMember } from "../family-view";
import BeneficiaryRowList, { type BeneficiaryRow } from "./beneficiary-row-list";
import { splitEvenly } from "./auto-split-percentages";
import TrustEndsSelect, { type TrustEnds } from "./trust-ends-select";
import { CurrencyInput } from "../currency-input";
import { PercentInput } from "../percent-input";
import { inputClassName, selectClassName, textareaClassName, fieldLabelClassName } from "./input-styles";
import AssetsTab, { type AssetsTabAccount, type AssetsTabLiability, type AssetsTabIncome, type AssetsTabExpense, type AssetsTabFamilyMember, type AssetsTabBusiness } from "./assets-tab";
import FlowsTab, {
  type FlowsTabIncome,
  type FlowsTabExpense,
  type ScheduleSaveBinding,
} from "./flows-tab";
import { applyAssetTabOp } from "./asset-tab-ops";
import type { AssetTabOp } from "./asset-tab-ops";
import TransfersTab, { type TransferEvent, type TransferSeries, type ExemptionDisplay } from "./transfers-tab";
import TransferAssetForm, { type AccountOption as AssetAccountOption } from "./transfer-asset-form";
import TransferCashForm from "./transfer-cash-form";
import TransferSeriesForm from "./transfer-series-form";
import SellToTrustDialog from "./sell-to-trust-dialog";
import { useScenarioState } from "@/hooks/use-scenario-state";
import DialogShell from "../dialog-shell";
import CltDetailsSection from "./clt-details-section";
import CrtDetailsSection from "./crt-details-section";
import { FieldTooltip } from "./field-tooltip";
import type { TrustSplitInterestInput } from "@/lib/schemas/trust-split-interest";
import {
  diffSplitInterestFundingPicks,
  type SplitInterestFundingPick,
} from "@/lib/forms/split-interest-funding-diff";
import type { SplitInterestFundingPickerAccount } from "./split-interest-funding-picker";
import { RETIREMENT_SUBTYPES } from "@/lib/ownership";
import type { SaveResult } from "@/lib/use-tab-auto-save";

interface AddTrustFormProps {
  clientId: string;
  editing?: Entity;
  household: { client: { firstName: string }; spouse: { firstName: string } | null };
  members: FamilyMember[];
  externals: ExternalBeneficiary[];
  entities: { id: string; name: string }[];  // for remainder picker
  initialDesignations?: Designation[];        // pre-loaded for edit mode
  activeTab: "details" | "flows" | "assets" | "transfers" | "notes" | "notes-sales";
  /** Assets tab data — when absent the tab degrades gracefully */
  accounts?: AssetsTabAccount[];
  liabilities?: AssetsTabLiability[];
  incomes?: AssetsTabIncome[];
  expenses?: AssetsTabExpense[];
  /** Business entities available to assign to this trust via the Assets-tab picker. */
  businesses?: AssetsTabBusiness[];
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
  /** Pushed up whenever the form's dirty/can-save state changes. Drives useTabAutoSave. */
  onAutoSaveStateChange?: (state: { isDirty: boolean; canSave: boolean }) => void;
  /** Reports the saved entity after every successful auto-save (create or edit). */
  onAutoSaved?: (entity: Entity, mode: "create" | "edit") => void;
  /** Reports live form state the dialog needs for conditional-tab visibility
   *  (e.g. whether to render Notes & sales). */
  onLiveStateChange?: (state: { trustSubType: string; isGrantor: boolean; isIrrevocable: boolean }) => void;
}

/** Imperative handle the EntityDialog uses to trigger a save on tab switch. */
export interface TrustFormAutoSaveHandle {
  saveAsync: () => Promise<SaveResult & { recordId?: string }>;
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
  irrevocable: "Irrevocable (generic)",
  ilit: "ILIT",
  clt: "CLT (Charitable Lead Trust)",
  idgt: "IDGT (Intentionally Defective Grantor Trust)",
  crt: "CRT (Charitable Remainder Trust)",
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

/**
 * The Notes & sales tab is meaningful only for trust structures that hold
 * promissory notes as part of an IDGT-style installment sale. IDGTs are the
 * canonical case; we also surface for any other irrevocable grantor trust so
 * advisors can model GRAT/SLAT note structures consistently. Revocable and
 * non-grantor trusts can't legally use this pattern, so the tab is hidden.
 */
function showNotesAndSales(t: Entity): boolean {
  if (t.trustSubType === "idgt") return true;
  return Boolean(t.isIrrevocable && t.isGrantor);
}

const AddTrustForm = forwardRef<TrustFormAutoSaveHandle, AddTrustFormProps>(function AddTrustForm({
  clientId, editing, household, members, externals, entities,
  initialDesignations, activeTab, accounts, liabilities, incomes, expenses,
  businesses,
  entityIncome, entityExpense,
  assetFamilyMembers,
  planEndYear,
  primaryClientBirthYear,
  initialFlowOverrides,
  onSaved, onClose, onSubmitStateChange,
  onScheduleSaveBindingChange,
  onAutoSaveStateChange,
  onAutoSaved,
  onLiveStateChange,
}, ref) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => onSubmitStateChange?.({ canSubmit: !loading, loading }), [loading, onSubmitStateChange]);
  const [effectiveEntityId, setEffectiveEntityId] = useState<string | null>(editing?.id ?? null);
  const router = useRouter();
  const scenarioWriter = useScenarioWriter(clientId);
  const { scenarioId } = useScenarioState(clientId);

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
  // includeInPortfolio is no longer a user-facing toggle — for revocable trusts
  // the assets pass through to the household, so we derive it from trustSubType
  // on save (see `derivedIncludeInPortfolio` below). The form keeps the original
  // value around only as a baseline so unrelated edits don't accidentally flip it.
  const editingIncludeInPortfolio = editing?.includeInPortfolio ?? false;
  const [crummeyPowers, setCrummeyPowers] = useState(
    (editing as { crummeyPowers?: boolean } | null)?.crummeyPowers ?? false,
  );
  const [sprinkleProvisions, setSprinkleProvisions] = useState(
    (editing as { accessibleToClient?: boolean } | null)?.accessibleToClient ?? false,
  );
  const [isGrantor, setIsGrantor] = useState(editing?.isGrantor ?? false);
  const [grantorStatusEndYear, setGrantorStatusEndYear] = useState<number | "">(
    editing?.grantorStatusEndYear != null ? editing.grantorStatusEndYear : ""
  );

  // Adopt the subtype's grantor default when the trust type changes. Create-only:
  // choosing a type is a fresh context, but editing an existing trust must never
  // clobber a stored value.
  useEffect(() => {
    if (!isCreate) return;
    if (trustSubType === "") return;
    setIsGrantor(defaultIsGrantorFor(trustSubType));
  }, [isCreate, trustSubType]);
  const [notes, setNotes] = useState(editing?.notes ?? "");

  // Distribution policy
  const [distributionMode, setDistributionMode] = useState<"fixed" | "pct_liquid" | "pct_income" | null>(editing?.distributionMode ?? null);
  const [distributionAmount, setDistributionAmount] = useState(editing?.distributionAmount != null ? String(editing.distributionAmount) : "");
  const [distributionPercent, setDistributionPercent] = useState(() => {
    const raw = editing?.distributionPercent;
    return raw != null ? (Number(raw) * 100).toFixed(2) : "";
  });

  // Beneficiary rows — built from initialDesignations, scoped to this entity.
  // `initialDesignations` is the household's full set across all trusts/accounts,
  // so we must filter by entityId to avoid bleeding rows from other entities
  // (which was the bug surfaced for new-trust create: stale beneficiaries from
  // sibling trusts appeared with a 200% sum).
  const scopedDesignations = useMemo(
    () => (editing ? (initialDesignations ?? []).filter((d) => d.entityId === editing.id) : []),
    [editing, initialDesignations],
  );
  const [incomeRows, setIncomeRows] = useState<BeneficiaryRow[]>(
    () => designationsToRows(scopedDesignations, "income"),
  );
  const [remainderRows, setRemainderRows] = useState<BeneficiaryRow[]>(() => {
    const rows = designationsToRows(scopedDesignations, "remainder");
    if (rows.length > 0 || !isCreate) return rows;
    // Create-mode default: split remainder evenly across children if any exist.
    const children = members.filter((m) => m.relationship === "child");
    if (children.length === 0) return rows;
    const pcts = splitEvenly(children.length);
    return children.map((child, i) => ({
      id: `tmp-${Math.random().toString(36).slice(2)}`,
      source: { kind: "family", familyMemberId: child.id },
      percentage: pcts[i],
      distributionForm: "outright" as const,
    }));
  });

  const isIrrevocable = trustSubType !== "" && deriveIsIrrevocable(trustSubType);
  // For split-interest trusts (CLT and CRT), the generic Distribution Policy
  // + Income Beneficiaries panels are suppressed. CLT income recipient is the
  // charity; CRT income beneficiary is captured by grantor + measuring life.
  // In both cases these panels don't apply.
  const isSplitInterest = trustSubType === "clt" || trustSubType === "crt";
  // CRT income beneficiary is captured by grantor + measuring life; CLT income
  // recipient is the charity. In both cases the generic Distribution + Income
  // beneficiary panels are suppressed.
  const showDistributionAndIncome = isIrrevocable && !isSplitInterest;

  // Push live state up so the parent dialog can conditionally show/hide tabs
  // (e.g. the Notes & sales tab visibility depends on these values).
  useEffect(() => {
    onLiveStateChange?.({ trustSubType, isGrantor, isIrrevocable });
  }, [trustSubType, isGrantor, isIrrevocable, onLiveStateChange]);

  // CLT split-interest state. Initialized lazily so re-renders don't reset.
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

  // Picks for the CLT funding-year FMV dropdown. Seeded from inception-year asset/cash transfers when editing.
  const [splitInterestFundingPicks, setSplitInterestFundingPicks] = useState<SplitInterestFundingPick[]>([]);
  const [originalSplitInterestFundingPicks, setOriginalSplitInterestFundingPicks] = useState<SplitInterestFundingPick[]>([]);

  // ── Dirty-tracking ──────────────────────────────────────────────────────────

  // Snapshot of every field sent in the entity POST/PUT body. Compared to
  // baselineRef.current to derive isDirty without expensive deep-equality.
  const currentSerialized = useMemo(() => JSON.stringify({
    name, trustSubType, isIrrevocable, isGrantor, grantor, trustee, trustEnds,
    grantorStatusEndYear, crummeyPowers, sprinkleProvisions, notes,
    distributionMode, distributionAmount, distributionPercent,
    incomeRows, remainderRows,
    ...(isSplitInterest ? { splitInterest, splitInterestFundingPicks } : {}),
  }), [
    name, trustSubType, isIrrevocable, isGrantor, grantor, trustee, trustEnds,
    grantorStatusEndYear, crummeyPowers, sprinkleProvisions, notes,
    distributionMode, distributionAmount, distributionPercent,
    incomeRows, remainderRows, splitInterest, splitInterestFundingPicks,
  ]);

  // Seeded to the current snapshot on mount so a freshly-opened dialog starts clean.
  const baselineRef = useRef<string>("");
  useEffect(() => {
    baselineRef.current = currentSerialized;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isDirty = currentSerialized !== baselineRef.current;
  const canSave = name.trim().length > 0 && trustSubType !== "";

  useEffect(() => {
    onAutoSaveStateChange?.({ isDirty, canSave });
  }, [isDirty, canSave, onAutoSaveStateChange]);

  // ── Transfers tab state ────────────────────────────────────────────────────
  const [openModal, setOpenModal] = useState<"asset" | "cash" | "series" | null>(null);
  const [transferEvents, setTransferEvents] = useState<TransferEvent[]>([]);
  const [transferSeries, setTransferSeries] = useState<TransferSeries[]>([]);
  const [transferFetchError, setTransferFetchError] = useState<string | null>(null);
  // refetchTick is bumped after a successful save so the useEffect re-runs.
  const [refetchTick, setRefetchTick] = useState(0);
  const [exemption, setExemption] = useState<ExemptionDisplay>({});
  const [totalConsumedByThisTrust, setTotalConsumedByThisTrust] = useState<{ client: number; spouse: number }>({ client: 0, spouse: 0 });

  // Self-fetch gifts and gift_series when the Transfers tab is active.
  // Mirrors the pattern used in beneficiaries-tab.tsx (per-account self-fetch on mount).
  // Fetches ALL gifts for the client then filters to this trust on the client side.
  useEffect(() => {
    // Fetch when editing any trust (Transfers tab is the obvious consumer; Details
    // tab also needs inception-year gifts for the CLT funding picker).
    if (!editing) return;
    // Skip the fetch on Details tab for non-CLT trusts to avoid the network hit.
    const needsGifts = activeTab === "transfers" || isSplitInterest;
    if (!needsGifts) return;
    let alive = true;
    setTransferFetchError(null);
    Promise.all([
      // One-time gifts are client-global (no scenario_id); series are
      // scenario-scoped, so the series list must match the active scenario.
      fetchJson<GiftRow[]>(`/api/clients/${clientId}/gifts`),
      fetchJson<GiftSeriesRow[]>(
        scenarioId
          ? `/api/clients/${clientId}/gifts/series?scenario=${encodeURIComponent(scenarioId)}`
          : `/api/clients/${clientId}/gifts/series`,
      ),
    ]).then(([allGifts, allSeries]) => {
      if (!alive) return;
      setTransferEvents(toTransferEvents(allGifts, editing.id, accounts ?? [], liabilities ?? []));
      setTransferSeries(toTransferSeries(allSeries, editing.id));
    }).catch((err: Error) => {
      if (!alive) return;
      console.error("[transfers-tab] fetch failed:", err);
      setTransferFetchError(err.message);
    });

    // Fetch lifetime-exemption ledger — panel stays hidden on failure (exemption {} hides it).
    fetchJson<{
      perGrantor: { client: { used: number; total: number }; spouse?: { used: number; total: number } };
      perTrust: Record<string, { client: number; spouse: number }>;
    }>(
      scenarioId
        ? `/api/clients/${clientId}/gifts/ledger?scenario=${encodeURIComponent(scenarioId)}`
        : `/api/clients/${clientId}/gifts/ledger`,
    ).then((summary) => {
      if (!alive) return;
      if (!summary?.perGrantor) return; // unexpected shape — leave panel hidden
      setExemption(summary.perGrantor);
      setTotalConsumedByThisTrust(summary.perTrust[editing.id] ?? { client: 0, spouse: 0 });
    }).catch(() => { /* panel stays hidden on failure */ });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, editing?.id, clientId, refetchTick, accounts, liabilities, trustSubType, scenarioId]);

  // Seed split-interest funding picks from transferEvents at the inception year.
  // Re-runs when the inception year changes or when transferEvents reload.
  useEffect(() => {
    if (!isSplitInterest) return;
    if (splitInterest.origin !== "new") return;
    if (!editing) return; // create mode has no fetched gifts to seed from
    const year = splitInterest.inceptionYear;
    const seeded: SplitInterestFundingPick[] = [];
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
    setSplitInterestFundingPicks(seeded);
    setOriginalSplitInterestFundingPicks(seeded);
  }, [trustSubType, splitInterest.origin, splitInterest.inceptionYear, transferEvents, accounts, editing]);

  const fundingAccounts = useMemo<SplitInterestFundingPickerAccount[]>(() => {
    if (!isSplitInterest) return [];
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
    if (!isSplitInterest) return;
    if (splitInterest.origin !== "new") return;
    const total = splitInterestFundingPicks.reduce((sum, p) => {
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
  }, [splitInterestFundingPicks, fundingAccounts, trustSubType, splitInterest.origin]);

  // ── Asset tab op handler ───────────────────────────────────────────────────
  const handleAssetTabOp = useCallback(async (op: AssetTabOp) => {
    if (!editing) return; // no trust id in create mode — shouldn't be reachable

    // Business entity branch — owner mutation + gift creation happens server-
    // side via the dedicated route. Client just relays the op (translating
    // `type` → `op` to match the API schema) and refreshes after success.
    if (op.assetType === "entity") {
      // F4: business-entity → trust assignment goes through the dedicated
      // base-only, non-idempotent route which also emits §709 gift rows. There
      // is no scenario-overlay equivalent yet, so block it in scenario mode
      // rather than silently writing to base while the rest of the dialog's
      // edits are scenario-scoped (split-brain).
      if (scenarioWriter.scenarioActive) {
        setError(
          "Assigning a business interest to this trust isn't supported inside a scenario yet — open the base plan to record it.",
        );
        return;
      }
      try {
        const apiBody: Record<string, unknown> = {
          op: op.type,
          assetType: op.assetType,
          assetId: op.assetId,
        };
        if (op.type === "add" || op.type === "set-percent") {
          apiBody.percent = op.percent;
        }
        const res = await fetch(
          `/api/clients/${clientId}/entities/${editing.id}/assets`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(apiBody),
          },
        );
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          setError(json.error ?? "Failed to assign business to trust");
          return;
        }
        // Refresh router so the new entity_owners + gift rows surface.
        router.refresh();
      } catch {
        setError("Failed to assign business to trust");
      }
      return;
    }

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
  }, [editing, accounts, liabilities, assetFamilyMembers, clientId, scenarioWriter, router]);

  // Pure save: validates, persists entity + CLT gift ops + designations, then
  // resets the dirty baseline. Shared between the explicit-submit path and the
  // tab-switch auto-save path so both routes use identical validation + payloads.
  const saveAsyncImpl = useCallback(async (): Promise<SaveResult & { recordId?: string; entity?: Entity }> => {
    if (!canSave) return { ok: false, error: "Please complete required fields before saving." };

    // Distribution mode set ⇒ ≥1 income beneficiary
    if (distributionMode != null && incomeRows.filter((r) => r.source.kind !== "empty").length === 0) {
      return { ok: false, error: "Distribution mode is set but no income beneficiaries are listed." };
    }
    if (isSplitInterest && splitInterest.origin === "new") {
      if (splitInterestFundingPicks.length === 0) {
        return { ok: false, error: "Pick at least one funding asset or cash gift for the CLT." };
      }
      const bad = splitInterestFundingPicks.find(
        (p) => (p.kind === "asset" ? p.percent <= 0 : p.amount <= 0),
      );
      if (bad) {
        return {
          ok: false,
          error: bad.kind === "asset"
            ? "Asset picks must have a percent greater than 0."
            : "Cash picks must have an amount greater than 0.",
        };
      }
    }

    // F4: create-mode + split-interest persistence depend on server-side base
    // writes with no scenario-overlay equivalent — the entities POST provisions
    // a per-scenario default-checking account + account_owners, CLT/CRT trusts
    // write trust_split_interest_details and auto-emit gift rows, and
    // beneficiary designations are a nested kind applyChanges can't add. None
    // are reproducible by an add/edit scenario_changes row. So in scenario mode
    // we only support EDITING an existing, non-split-interest trust's scalar
    // fields; everything else stays base-only.
    const scenarioActive = scenarioWriter.scenarioActive;
    const editTargetId = effectiveEntityId ?? editing?.id ?? null;
    if (scenarioActive && (editTargetId == null || isSplitInterest)) {
      return {
        ok: false,
        error: editTargetId == null
          ? "Creating a new trust isn't supported inside a scenario yet — create it in the base plan, then adjust it here."
          : "CLT/CRT split-interest details can't be edited inside a scenario yet — edit them in the base plan.",
      };
    }

    setLoading(true);
    setError(null);
    try {
      // includeInPortfolio is no longer user-controlled. Every trust subtype is
      // now out of estate (revocable trusts are modeled as a tag, not an entity),
      // so we just preserve any value an old row's toggle set — avoids silent
      // behavior changes when an advisor opens an old trust just to edit notes.
      const derivedIncludeInPortfolio = editingIncludeInPortfolio;

      // Build entity body — mirrors the old handleSubmit payload exactly.
      const entityBody = {
        name,
        entityType: "trust",
        notes: notes || null,
        includeInPortfolio: derivedIncludeInPortfolio,
        accessibleToClient: sprinkleProvisions,
        crummeyPowers,
        isGrantor,
        grantorStatusEndYear: isIrrevocable && isGrantor && grantorStatusEndYear !== "" ? grantorStatusEndYear : null,
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
        ...(isSplitInterest && { splitInterest }),
      };

      // Choose POST vs PUT based on whether we have a persisted id yet. In
      // scenario mode the gating above guarantees targetId != null (edit only),
      // so the PUT routes through the scenario writer with targetKind:"entity"
      // (mirrors flows-tab). Base mode passes straight through to the legacy
      // per-entity route. We overlay only the SCALAR trust fields: the engine
      // tree (EntitySummary) derives owner/beneficiaries/value/entityType from
      // other sources, so overlaying those DB-write-shape fields would clobber
      // loader-derived data.
      const targetId = effectiveEntityId ?? editing?.id ?? null;
      const url = targetId
        ? `/api/clients/${clientId}/entities/${targetId}`
        : `/api/clients/${clientId}/entities`;
      const scenarioOmit = new Set(["owner", "beneficiaries", "value", "entityType"]);
      const scenarioEntityFields = Object.fromEntries(
        Object.entries(entityBody).filter(([k]) => !scenarioOmit.has(k)),
      );
      const res = targetId
        ? await scenarioWriter.submit(
            {
              op: "edit",
              targetKind: "entity",
              targetId,
              desiredFields: scenarioEntityFields,
            },
            { url, method: "PUT", body: entityBody },
          )
        : await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(entityBody),
          });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        return { ok: false, error: j.error ?? "Failed to save" };
      }
      // In scenario-edit mode the changes route returns { ok: true } with no
      // entity echo; synthesize the saved row from the known id + submitted body
      // so downstream callbacks keep working. Base mode parses the real entity.
      const saved: Entity = scenarioActive
        ? ({ ...editing, ...entityBody, id: targetId! } as unknown as Entity)
        : ((await res.json()) as Entity);

      // Apply split-interest funding-pick changes as gift ops.
      if (isSplitInterest && splitInterest.origin === "new") {
        const ops = diffSplitInterestFundingPicks({
          original: originalSplitInterestFundingPicks,
          current: splitInterestFundingPicks,
          entityId: saved.id,
          year: splitInterest.inceptionYear,
          defaultAssetGrantor: grantor === "" ? "client" : grantor,
        });
        for (const op of ops) {
          if (op.type === "create") {
            const giftRes = await fetch(`/api/clients/${clientId}/gifts`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(op.body),
            });
            if (!giftRes.ok) {
              const j = (await giftRes.json().catch(() => ({}))) as { error?: string };
              return { ok: false, error: j.error ?? `Failed to create gift (HTTP ${giftRes.status})` };
            }
          } else if (op.type === "update") {
            const giftRes = await fetch(`/api/clients/${clientId}/gifts/${op.giftId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(op.body),
            });
            if (!giftRes.ok) {
              const j = (await giftRes.json().catch(() => ({}))) as { error?: string };
              return { ok: false, error: j.error ?? `Failed to update gift (HTTP ${giftRes.status})` };
            }
          } else {
            const giftRes = await fetch(`/api/clients/${clientId}/gifts/${op.giftId}`, {
              method: "DELETE",
            });
            if (!giftRes.ok) {
              const j = (await giftRes.json().catch(() => ({}))) as { error?: string };
              return { ok: false, error: j.error ?? `Failed to delete gift (HTTP ${giftRes.status})` };
            }
          }
        }
      }

      // Save designations (income + remainder). beneficiary_designation is a
      // nested kind (TARGET_KIND_TO_FIELD maps it to null → applyChanges throws
      // on add/edit), so there is no scenario-overlay path. In scenario mode we
      // skip the designations write — base designations stay in effect for the
      // projection. (Tracked: scenario-aware beneficiary designations.)
      if (!scenarioActive) {
        const designations = [
          ...rowsToDesignationPayload(incomeRows, "income"),
          ...rowsToDesignationPayload(remainderRows, "remainder"),
        ];
        const desigRes = await fetch(`/api/clients/${clientId}/entities/${saved.id}/beneficiaries`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(designations),
        });
        if (!desigRes.ok) {
          const j = (await desigRes.json().catch(() => ({}))) as { error?: string };
          return { ok: false, error: j.error ?? "Failed to save beneficiaries" };
        }
      }

      // Capture whether this was the first create BEFORE flipping effectiveEntityId.
      const wasFirstCreate = !effectiveEntityId && !editing;
      // Flip into PUT-mode after first successful POST.
      if (wasFirstCreate) {
        setEffectiveEntityId(saved.id);
      }
      // Reset the dirty baseline so subsequent edits are correctly tracked.
      baselineRef.current = currentSerialized;
      // onAutoSaved fires on every successful save (autosave + explicit submit).
      // onSaved (close-the-dialog signal) is called by handleSubmit only.
      onAutoSaved?.(saved, wasFirstCreate ? "create" : "edit");
      return { ok: true, recordId: saved.id, entity: saved };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
    } finally {
      setLoading(false);
    }
  }, [
    canSave, trustSubType, distributionMode, incomeRows, splitInterest, splitInterestFundingPicks,
    effectiveEntityId, editing, clientId, currentSerialized,
    name, notes, editingIncludeInPortfolio, sprinkleProvisions, crummeyPowers,
    isGrantor, grantorStatusEndYear,
    isIrrevocable, grantor, trustee, trustEnds, showDistributionAndIncome,
    distributionAmount, distributionPercent, remainderRows,
    originalSplitInterestFundingPicks, onAutoSaved,
  ]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Snapshot wasFirstCreate before saveAsyncImpl, which flips effectiveEntityId.
    const wasFirstCreate = !effectiveEntityId && !editing;
    const result = await saveAsyncImpl();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // onSaved fires only here — on explicit user submit (dialog-close signal).
    if (result.entity) {
      onSaved(result.entity, wasFirstCreate ? "create" : "edit");
    }
    onClose();
  }

  useImperativeHandle(ref, () => ({
    saveAsync: saveAsyncImpl,
  }), [saveAsyncImpl]);

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
              {Object.entries(TRUST_TYPE_LABELS)
                .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
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

        {/* Income + Remainder Beneficiaries — side-by-side when both visible.
            Income is hidden for revocable trusts; remainder falls back to full width. */}
        <div className={`mt-4 grid gap-4 ${showDistributionAndIncome ? "grid-cols-2" : "grid-cols-1"}`}>
          {showDistributionAndIncome && (
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
          )}
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

        {trustSubType === "clt" && (
          <div className="mt-4">
            <CltDetailsSection
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
              fundingPicks={splitInterestFundingPicks}
              onFundingPicksChange={setSplitInterestFundingPicks}
              defaultGrantor={grantor === "" ? "client" : grantor}
            />
          </div>
        )}

        {trustSubType === "crt" && (
          <div className="mt-4">
            <CrtDetailsSection
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
              fundingPicks={splitInterestFundingPicks}
              onFundingPicksChange={setSplitInterestFundingPicks}
              defaultGrantor={grantor === "" ? "client" : grantor}
            />
          </div>
        )}

        {/* Provisions */}
        <div className="mt-4 rounded-[var(--radius-sm)] border border-hair bg-card-2 p-3 space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            Provisions
          </div>
          <div className="divide-y divide-hair">
            {isIrrevocable && (
              <ProvisionRow
                label="Crummey powers"
                tooltip="Gives beneficiaries a short window (typically 30–60 days) to withdraw new contributions. Qualifies gifts to the trust for the annual gift-tax exclusion."
                checked={crummeyPowers}
                onChange={setCrummeyPowers}
              />
            )}
            {isIrrevocable && (
              <ProvisionRow
                label="Sprinkle provisions"
                tooltip="Lets the client tap trust liquid assets once household liquid assets run out (HEMS / distribution-committee clause). Surfaces the trust in the Accessible Trust Assets column on the cash-flow drill."
                checked={sprinkleProvisions}
                onChange={setSprinkleProvisions}
              />
            )}
            <ProvisionRow
              label="Grantor trust"
              tooltip="Trust income is taxed on the grantor's personal 1040 — the household pays the tax instead of the trust."
              checked={isGrantor}
              onChange={(v) => {
                setIsGrantor(v);
                if (!v) setGrantorStatusEndYear("");
              }}
            />
            {trustSubType === "clt" && (
              <p className="text-ink-4 pt-1 text-xs">
                Grantor CLT: the grantor deducts the present value of the charity&rsquo;s
                lead interest up front, in the funding year (§170(f)(2)(B)), and is taxed
                on the trust&rsquo;s income each year. Non-grantor CLT: no up-front
                deduction &mdash; the trust deducts each year&rsquo;s payment to charity
                instead (§642(c)).
              </p>
            )}
          </div>
          {isIrrevocable && isGrantor && (
            <div className="pt-1">
              <label className={fieldLabelClassName} htmlFor="grantor-status-end-year">
                Grantor status ends after year <span className="text-ink-4 font-normal">(optional)</span>
              </label>
              <input
                id="grantor-status-end-year"
                type="number"
                min={1900}
                max={2200}
                step={1}
                value={grantorStatusEndYear}
                onChange={(e) =>
                  setGrantorStatusEndYear(e.target.value === "" ? "" : parseInt(e.target.value, 10))
                }
                placeholder="Leave blank for permanent"
                className={inputClassName}
              />
            </div>
          )}
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
            businesses={businesses}
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
              exemption={exemption}
              totalConsumedByThisTrust={totalConsumedByThisTrust}
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

      <div className={activeTab !== "notes-sales" ? "hidden" : ""}>
        {editing ? (
          showNotesAndSales(editing) ? (
            <div className="space-y-4">
              <SellToTrustDialog
                clientId={clientId}
                scenarioId={scenarioId}
                trust={editing}
                accounts={accounts ?? []}
              />
              {!scenarioId && (
                <p className="text-[12px] text-ink-3">
                  Selling assets to the trust requires an active scenario. Open
                  this trust from a scenario view to record a sale-to-trust
                  event.
                </p>
              )}
            </div>
          ) : (
            <p className="text-[13px] text-ink-3 text-center py-6">
              Notes &amp; sales are available for IDGT and other irrevocable
              grantor trusts.
            </p>
          )
        ) : (
          <p className="text-[13px] text-ink-3 text-center py-6">
            Notes &amp; sales are available when editing an existing trust.
          </p>
        )}
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
            scenarioId={scenarioId}
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
});

export default AddTrustForm;

function ProvisionRow({
  label,
  tooltip,
  checked,
  onChange,
}: {
  label: string;
  tooltip: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
      <Switch checked={checked} onChange={onChange} aria-label={label} />
      <span className="text-sm text-ink-2">{label}</span>
      <FieldTooltip text={tooltip} />
    </div>
  );
}

function Switch({
  checked,
  onChange,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
        checked
          ? "border-accent bg-accent"
          : "border-hair bg-card"
      }`}
    >
      <span
        aria-hidden="true"
        className={`block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-[18px]" : "translate-x-[2px]"
        }`}
      />
    </button>
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

export function designationsToRows(d: Designation[], tier: "income" | "remainder"): BeneficiaryRow[] {
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

export function rowsToDesignationPayload(rows: BeneficiaryRow[], tier: "income" | "remainder") {
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
