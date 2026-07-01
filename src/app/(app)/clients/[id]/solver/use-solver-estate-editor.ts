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
import { buildRevertFundingMutation } from "@/lib/solver/trust-levers";
import type { SolverTrustDraft } from "./solver-trust-form";
import {
  currentTrustEntities,
  currentCharities,
  type CurrentCharity,
} from "@/lib/solver/estate-current";

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
  // Working tree, needed by the gift dialog + trust form.
  clientData: ClientData;
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
  currentTrusts: EntitySummary[];
  trusts: SolverTrustDraft[];
  addingTrust: boolean;
  setAddingTrust: (v: boolean) => void;
  addTrust: (mutations: SolverMutation[], draft: SolverTrustDraft) => void;
  removeTrust: (draft: SolverTrustDraft) => void;
  isMarried: boolean;
  // ── Charities ──
  baseCharities: CurrentCharity[];
  addedCharities: CurrentCharity[];
  charityName: string;
  setCharityName: (v: string) => void;
  charityType: "public" | "private";
  setCharityType: (v: "public" | "private") => void;
  addCharity: () => void;
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

  const [enabled, setEnabled] = useState(false);
  const [trustName, setTrustName] = useState("Revocable Living Trust");
  const [taggedIds, setTaggedIds] = useState<Set<string>>(new Set());

  // ── Planned gifts ──────────────────────────────────────────────────────────
  const [gifts, setGifts] = useState<EstateFlowGift[]>(() => baseGifts);
  const baseGiftIds = useMemo(() => new Set(baseGifts.map((g) => g.id)), [baseGifts]);
  const [editing, setEditing] = useState<EstateFlowGift | null>(null);
  const [adding, setAdding] = useState(false);

  // Inline charity sub-form (the DB-coupled ExternalBeneficiaryDialog is unusable here).
  const [charityName, setCharityName] = useState("");
  const [charityType, setCharityType] = useState<"public" | "private">("public");

  // ── Trusts ──────────────────────────────────────────────────────────────────
  const [trusts, setTrusts] = useState<SolverTrustDraft[]>([]);
  const [addingTrust, setAddingTrust] = useState(false);
  const isMarried = clientData.client.spouseDob != null;

  function addTrust(mutations: SolverMutation[], draft: SolverTrustDraft) {
    for (const m of mutations) onChange(m);
    setTrusts((ts) => [...ts, draft]);
  }

  function removeTrust(draft: SolverTrustDraft) {
    // Revert each funded account, then delete the entity.
    for (const orig of draft.fundedOriginals) onChange(buildRevertFundingMutation(orig));
    onChange({ kind: "entity-upsert", id: draft.entity.id, value: null });
    // CLT: also clear the auto-emitted remainder-interest gift so it doesn't
    // orphan onto a deleted entity.
    if (draft.remainderGiftId)
      onChange({ kind: "gift-upsert", id: draft.remainderGiftId, value: null });
    setTrusts((ts) => ts.filter((t) => t.entity.id !== draft.entity.id));
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

  // ── Current (base) estate facts surfaced read-only alongside scenario edits ──
  const currentTrusts = useMemo(
    () => currentTrustEntities(baseClientData.entities),
    [baseClientData.entities],
  );
  const baseCharities = useMemo(
    () => currentCharities(baseClientData.externalBeneficiaries),
    [baseClientData.externalBeneficiaries],
  );
  // Scenario-added charities = working charities not present in base facts.
  const addedCharities = useMemo(() => {
    const baseIds = new Set(baseCharities.map((c) => c.id));
    return currentCharities(clientData.externalBeneficiaries).filter((c) => !baseIds.has(c.id));
  }, [clientData.externalBeneficiaries, baseCharities]);

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

  function addCharity() {
    const name = charityName.trim();
    if (!name) return;
    createCharity(name, charityType);
    setCharityName("");
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
    const trustCount = currentTrusts.length + trusts.length;
    const charityCount = baseCharities.length + addedCharities.length;
    return {
      rltEnabled: enabled,
      taggedCount: taggedIds.size,
      giftCount,
      trustCount,
      charityCount,
      isEmpty: !enabled && giftCount === 0 && trustCount === 0 && charityCount === 0,
    };
  }, [enabled, taggedIds, gifts, currentTrusts, trusts, baseCharities, addedCharities]);

  return {
    clientData,
    enabled, trustName, eligible, taggedIds,
    toggleEnabled, changeName, toggleAccount, selectAll,
    gifts, baseGiftIds, toggleGift, upsertGift, deleteGift,
    editing, setEditing, adding, setAdding,
    taxInflationRate, annualExclusionByYear,
    currentTrusts, trusts, addingTrust, setAddingTrust, addTrust, removeTrust, isMarried,
    baseCharities, addedCharities,
    charityName, setCharityName, charityType, setCharityType, addCharity, createCharity,
    summary,
  };
}
