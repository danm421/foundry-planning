"use client";

import { useMemo, useState } from "react";
import type { Account, ClientData, EntitySummary } from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { addGift, removeGift, updateGift } from "@/lib/estate/estate-flow-gifts";
import { buildAnnualExclusionMap } from "@/lib/gifts/resolve-annual-exclusion";
import {
  isRevocableTagEligible,
  buildRevocableTagMutations,
} from "@/lib/solver/estate-levers";
import {
  buildDissolveTrustMutations,
  buildRevertFundingMutation,
} from "@/lib/solver/trust-levers";
import { buildRemoveCharityMutations } from "@/lib/solver/charity-levers";
import type { SolverTrustDraft } from "./solver-trust-form";
import { currentTrustEntities, currentCharities } from "@/lib/solver/estate-current";
import type { EstatePane, RailCharity, RailTrust } from "./solver-estate-rail";

export interface EstateSummary {
  rltEnabled: boolean;
  taggedCount: number;
  /** Count of gifts that are active (not toggled off). */
  giftCount: number;
  /** Existing (base) + scenario-added trusts. */
  trustCount: number;
  /** Base + scenario-added charities. */
  charityCount: number;
  /** True when nothing at all is configured. */
  isEmpty: boolean;
}

interface Args {
  baseClientData: ClientData;
  clientData: ClientData;
  baseGifts: EstateFlowGift[];
  onChange: (m: SolverMutation) => void;
}

export interface EstateEditor {
  // Working tree, needed by the gift dialog, the trust form and the panes.
  clientData: ClientData;
  // ── Which pane the rail is showing ──
  selection: EstatePane;
  setSelection: (p: EstatePane) => void;
  // ── RLT ──
  enabled: boolean;
  trustName: string;
  eligible: Account[];
  taggedIds: Set<string>;
  toggleEnabled: (on: boolean) => void;
  changeName: (name: string) => void;
  toggleAccount: (id: string) => void;
  selectAll: () => void;
  // ── Gifts ──
  gifts: EstateFlowGift[];
  baseGiftIds: Set<string>;
  toggleGift: (g: EstateFlowGift) => void;
  upsertGift: (draft: EstateFlowGift) => void;
  deleteGift: (id: string) => void;
  editing: EstateFlowGift | null;
  setEditing: (g: EstateFlowGift | null) => void;
  adding: boolean;
  setAdding: (v: boolean) => void;
  taxInflationRate: number;
  annualExclusionByYear: ReturnType<typeof buildAnnualExclusionMap>;
  // ── Trusts ──
  /** Every trust the working tree holds — base plan and scenario-added alike. */
  railTrusts: RailTrust[];
  addTrust: (mutations: SolverMutation[], draft: SolverTrustDraft) => void;
  removeTrust: (trust: EntitySummary) => void;
  isMarried: boolean;
  // ── Charities ──
  railCharities: RailCharity[];
  addCharity: (name: string, charityType: "public" | "private") => void;
  updateCharity: (c: RailCharity) => void;
  removeCharity: (id: string) => void;
  createCharity: (name: string, type: "public" | "private") => string;
  // ── Derived ──
  summary: EstateSummary;
}

export function useSolverEstateEditor({
  baseClientData,
  clientData,
  baseGifts,
  onChange,
}: Args): EstateEditor {
  const accounts = baseClientData.accounts;
  const eligible = useMemo(
    () => accounts.filter(isRevocableTagEligible),
    [accounts],
  );

  const [selection, setSelection] = useState<EstatePane>({ kind: "overview" });

  const [enabled, setEnabled] = useState(false);
  const [trustName, setTrustName] = useState("Revocable Living Trust");
  const [taggedIds, setTaggedIds] = useState<Set<string>>(new Set());

  // ── Planned gifts ──────────────────────────────────────────────────────────
  const [gifts, setGifts] = useState<EstateFlowGift[]>(() => baseGifts);
  const baseGiftIds = useMemo(() => new Set(baseGifts.map((g) => g.id)), [baseGifts]);
  const [editing, setEditing] = useState<EstateFlowGift | null>(null);
  const [adding, setAdding] = useState(false);

  // ── Trusts ──────────────────────────────────────────────────────────────────
  // `trusts` holds one draft per trust CREATED in this browser session. Its only
  // job is `fundedOriginals` — the exact prior owners of each account the add
  // form retitled — so a removal can hand them back untouched. The rail reads
  // the working tree instead, which is why a base-plan trust needs no draft.
  const [trusts, setTrusts] = useState<SolverTrustDraft[]>([]);
  const isMarried = clientData.client.spouseDob != null;

  function addTrust(mutations: SolverMutation[], draft: SolverTrustDraft) {
    for (const m of mutations) onChange(m);
    setTrusts((ts) => [...ts, draft]);
    setSelection({ kind: "trust", id: draft.entity.id });
  }

  /**
   * Dissolve a trust — base plan or scenario-added. The lever reads the WORKING
   * tree, so it reaches everything a draft cannot see: an account or liability
   * retitled into this trust after it was created, a will bequest or another
   * trust's beneficiary list naming it, and a CLT's auto-emitted
   * remainder-interest gift.
   *
   * A base-plan trust has no draft, which is the same thing as having funded
   * nothing here: every account falls through to the lever's "return it to the
   * grantor" rule, and `setTrusts` is a harmless no-op.
   */
  function removeTrust(trust: EntitySummary) {
    const entity = (clientData.entities ?? []).find((e) => e.id === trust.id) ?? trust;
    const draft = trusts.find((t) => t.entity.id === trust.id);
    const originals = new Map((draft?.fundedOriginals ?? []).map((a) => [a.id, a]));
    for (const m of buildDissolveTrustMutations(clientData, entity)) {
      // A trust funded in THIS session knows each account's exact prior owners.
      // Restoring them beats the lever's "return it to the grantor" rule, which
      // would hand a 50/50 joint account entirely to one spouse. Swapped in
      // place so the lever's ordering — entity delete last — is preserved.
      //
      // A revert fires only for an account the lever still sees as this trust's.
      // One funded here and since retitled elsewhere is left alone rather than
      // clobbered back to its pre-funding owners.
      const original = m.kind === "account-upsert" ? originals.get(m.id) : undefined;
      onChange(original ? buildRevertFundingMutation(original) : m);
    }
    setTrusts((ts) => ts.filter((t) => t.entity.id !== trust.id));
    setSelection({ kind: "overview" });
  }

  const ps = clientData.planSettings;
  const taxInflationRate = ps.taxInflationRate ?? ps.inflationRate ?? 0;
  const annualExclusionByYear = useMemo(
    () =>
      buildAnnualExclusionMap(
        clientData.taxYearRows ?? [],
        ps.planStartYear,
        ps.planEndYear,
        taxInflationRate,
      ),
    [clientData.taxYearRows, ps.planStartYear, ps.planEndYear, taxInflationRate],
  );

  // ── Rail rows ───────────────────────────────────────────────────────────────
  //
  // The rows come from the WORKING tree, so a rename made in the trust editor
  // shows up in the rail and a removed trust leaves it. `isBase` is the one
  // thing the working tree cannot answer — a solver-added trust sits in it too —
  // so it is decided by membership in the BASE tree. It is what
  // `SolverTrustEditor`'s `isPersisted` means: this trust has a real `entities`
  // row, so a promissory note may legally name it.
  const baseTrustIds = useMemo(
    () => new Set(currentTrustEntities(baseClientData.entities).map((t) => t.id)),
    [baseClientData.entities],
  );
  const railTrusts = useMemo<RailTrust[]>(
    () =>
      currentTrustEntities(clientData.entities).map((t) => ({
        id: t.id,
        name: t.name?.trim() || "Trust",
        subType: t.trustSubType ? t.trustSubType.toUpperCase() : null,
        isBase: baseTrustIds.has(t.id),
      })),
    [clientData.entities, baseTrustIds],
  );

  const baseCharityIds = useMemo(
    () => new Set(currentCharities(baseClientData.externalBeneficiaries).map((c) => c.id)),
    [baseClientData.externalBeneficiaries],
  );
  const railCharities = useMemo<RailCharity[]>(
    () =>
      currentCharities(clientData.externalBeneficiaries).map((c) => ({
        ...c,
        isBase: baseCharityIds.has(c.id),
      })),
    [clientData.externalBeneficiaries, baseCharityIds],
  );

  function toggleGift(g: EstateFlowGift) {
    const next: EstateFlowGift = { ...g, enabled: g.enabled === false ? undefined : false };
    setGifts((gs) => updateGift(gs, next));
    onChange({ kind: "gift-upsert", id: g.id, value: next });
  }

  function upsertGift(draft: EstateFlowGift) {
    const prior = gifts.find((g) => g.id === draft.id);
    const value: EstateFlowGift = { ...draft, enabled: prior?.enabled };
    setGifts((gs) => (prior ? updateGift(gs, value) : addGift(gs, value)));
    onChange({ kind: "gift-upsert", id: value.id, value });
    setEditing(null);
    setAdding(false);
  }

  function deleteGift(id: string) {
    setGifts((gs) => removeGift(gs, id));
    onChange({ kind: "gift-upsert", id, value: null });
    setEditing(null);
  }

  /** Mint a charity external-beneficiary, emit its upsert, and return its id. */
  function createCharity(name: string, type: "public" | "private"): string {
    const id = crypto.randomUUID();
    onChange({
      kind: "external-beneficiary-upsert",
      id,
      value: { id, name, kind: "charity", charityType: type },
    });
    return id;
  }

  function addCharity(name: string, charityType: "public" | "private") {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSelection({ kind: "charity", id: createCharity(trimmed, charityType) });
  }

  function updateCharity(c: RailCharity) {
    onChange({
      kind: "external-beneficiary-upsert",
      id: c.id,
      value: { id: c.id, name: c.name, kind: "charity", charityType: c.charityType },
    });
  }

  /**
   * Remove a charity and every reference to it. The bare delete this used to
   * emit left `BeneficiaryRef.externalBeneficiaryId` dangling, and the two
   * halves of the product then disagreed about where the asset went at death:
   * the live death event still paid the designation out of the household
   * (`death-event/shared.ts:639-643`), while a reloaded scenario dropped the ref
   * (`cascadeResolution.ts:305-372`) and fell back to the estate.
   */
  function removeCharity(id: string) {
    for (const m of buildRemoveCharityMutations(clientData, id)) onChange(m);
    setSelection({ kind: "overview" });
  }

  function apply(nextTagged: Set<string>, nextName: string) {
    for (const m of buildRevocableTagMutations(accounts, nextTagged, nextName)) {
      onChange(m);
    }
  }

  function toggleEnabled(on: boolean) {
    setEnabled(on);
    // On enable: preserve the previous selection (user can refine before re-dispatch).
    // On disable: clear the selection so every eligible account gets a null-clearing upsert.
    const next = on ? taggedIds : new Set<string>();
    if (!on) setTaggedIds(next);
    apply(next, trustName);
  }

  function toggleAccount(id: string) {
    const next = new Set(taggedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTaggedIds(next);
    apply(next, trustName);
  }

  function selectAll() {
    const next = new Set(eligible.map((a) => a.id));
    setTaggedIds(next);
    apply(next, trustName);
  }

  function changeName(name: string) {
    setTrustName(name);
    if (enabled) apply(taggedIds, name);
  }

  const summary: EstateSummary = useMemo(() => {
    const giftCount = gifts.filter((g) => g.enabled !== false).length;
    const trustCount = railTrusts.length;
    const charityCount = railCharities.length;
    return {
      rltEnabled: enabled,
      taggedCount: taggedIds.size,
      giftCount,
      trustCount,
      charityCount,
      isEmpty: !enabled && giftCount === 0 && trustCount === 0 && charityCount === 0,
    };
  }, [enabled, taggedIds, gifts, railTrusts, railCharities]);

  return {
    clientData,
    selection, setSelection,
    enabled, trustName, eligible, taggedIds,
    toggleEnabled, changeName, toggleAccount, selectAll,
    gifts, baseGiftIds, toggleGift, upsertGift, deleteGift,
    editing, setEditing, adding, setAdding,
    taxInflationRate, annualExclusionByYear,
    railTrusts, addTrust, removeTrust, isMarried,
    railCharities, addCharity, updateCharity, removeCharity, createCharity,
    summary,
  };
}
