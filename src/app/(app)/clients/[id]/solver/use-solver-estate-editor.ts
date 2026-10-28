"use client";

import { useMemo, useState } from "react";
import type { Account, ClientData, EntitySummary } from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { addGift, removeGift, updateGift } from "@/lib/estate/estate-flow-gifts";
import { buildAnnualExclusionMap } from "@/lib/gifts/resolve-annual-exclusion";
import {
  buildDissolveTrustMutations,
  buildRevertFundingMutation,
} from "@/lib/solver/trust-levers";
import { buildRemoveCharityMutations } from "@/lib/solver/charity-levers";
import { trustTypeLabel, type SolverTrustDraft } from "@/lib/solver/guided-trust";
import type { GuidedTrustBatch } from "@/lib/solver/guided-trust-batch";
import {
  buildRevocableMembershipMutations,
  buildRevocableRenameMutations,
  revocableTrustRows,
  type RevocableTrustRow,
} from "@/lib/solver/revocable-trust-rows";
import { currentTrustEntities, currentCharities } from "@/lib/solver/estate-current";
import type { EstatePane, RailCharity, RailTrust } from "./solver-estate-rail";

export interface EstateSummary {
  /** Count of gifts that are active (not toggled off). */
  giftCount: number;
  /** Existing (base) + scenario-added trusts, revocable living trusts included. */
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
  // Working tree, needed by the gift dialog, the wizard and the panes.
  clientData: ClientData;
  // ── Which pane the rail is showing ──
  selection: EstatePane;
  /** Also drops `notice`: it is shown once, on the pane it was set for. */
  setSelection: (p: EstatePane) => void;
  /** One-time confirmation above a trust's editor after Add trust / Add funding. */
  notice: { trustId: string; text: string } | null;
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
  /** Every trust entity the working tree holds — base plan and scenario-added alike. */
  railTrusts: RailTrust[];
  /** Every revocable living trust: base names plus names added in the working tree. */
  railRevocableTrusts: RevocableTrustRow[];
  /** Emits the wizard's batch and opens what it made. `fundingLabels` feed the
   *  one-time "Added. Funding: …" notice. */
  addTrust: (batch: GuidedTrustBatch, fundingLabels: string[]) => void;
  /** Emits an existing trust's new funding and returns to its editor. */
  addFunding: (
    trustId: string,
    mutations: SolverMutation[],
    fundedOriginals: Account[],
    labels: string[],
  ) => void;
  removeTrust: (trust: EntitySummary) => void;
  setRevocableMembership: (name: string, accountIds: ReadonlySet<string>) => void;
  renameRevocableTrust: (from: string, to: string) => void;
  removeRevocableTrust: (name: string) => void;
  // ── Charities ──
  railCharities: RailCharity[];
  addCharity: (name: string, charityType: "public" | "private") => void;
  updateCharity: (c: RailCharity) => void;
  removeCharity: (id: string) => void;
  // ── Derived ──
  summary: EstateSummary;
}

export function useSolverEstateEditor({
  baseClientData,
  clientData,
  baseGifts,
  onChange,
}: Args): EstateEditor {
  const [selection, setSelectionState] = useState<EstatePane>({ kind: "overview" });
  const [notice, setNotice] = useState<EstateEditor["notice"]>(null);

  function setSelection(p: EstatePane) {
    setNotice(null);
    setSelectionState(p);
  }

  // ── Planned gifts ──────────────────────────────────────────────────────────
  const [gifts, setGifts] = useState<EstateFlowGift[]>(() => baseGifts);
  const baseGiftIds = useMemo(() => new Set(baseGifts.map((g) => g.id)), [baseGifts]);
  const [editing, setEditing] = useState<EstateFlowGift | null>(null);
  const [adding, setAdding] = useState(false);

  /** Emit in order, and keep Planned gifts in step with every gift among them. */
  function emit(mutations: SolverMutation[]) {
    const upserts = new Map<string, EstateFlowGift | null>();
    for (const m of mutations) {
      onChange(m);
      if (m.kind === "gift-upsert") upserts.set(m.id, m.value);
    }
    if (upserts.size === 0) return;
    setGifts((gs) => {
      let next = gs;
      for (const [id, value] of upserts) {
        if (!value) next = removeGift(next, id);
        else next = next.some((g) => g.id === id) ? updateGift(next, value) : addGift(next, value);
      }
      return next;
    });
  }

  // ── Trusts ──────────────────────────────────────────────────────────────────
  // `trusts` holds one draft per trust funded in this browser session — created
  // by the wizard, or given more funding through Add funding. Its only job is
  // `fundedOriginals`: the exact prior owners of each account retitled into the
  // trust here, so a removal can hand them back untouched. The rail reads the
  // working tree instead, which is why an unfunded base-plan trust needs no draft.
  const [trusts, setTrusts] = useState<SolverTrustDraft[]>([]);

  function addTrust(batch: GuidedTrustBatch, fundingLabels: string[]) {
    emit(batch.mutations);
    const { draft } = batch;
    if (draft) setTrusts((ts) => [...ts, draft]);
    if (batch.select.kind === "trust") {
      setSelection({ kind: "trust", id: batch.select.id });
      setNotice({
        trustId: batch.select.id,
        text: fundingLabels.length > 0 ? `Added. Funding: ${fundingLabels.join("; ")}` : "Added. Not funded yet.",
      });
    } else {
      setSelection({ kind: "revocable", name: batch.select.name });
    }
  }

  function addFunding(
    trustId: string,
    mutations: SolverMutation[],
    fundedOriginals: Account[],
    labels: string[],
  ) {
    emit(mutations);
    const entity = (clientData.entities ?? []).find((e) => e.id === trustId);
    if (fundedOriginals.length > 0 && entity) {
      setTrusts((ts) =>
        ts.some((t) => t.entity.id === trustId)
          ? ts.map((t) =>
              t.entity.id === trustId ? { ...t, fundedOriginals: [...t.fundedOriginals, ...fundedOriginals] } : t,
            )
          : [...ts, { entity, fundedOriginals }],
      );
    }
    setSelection({ kind: "trust", id: trustId });
    setNotice({ trustId, text: `Added funding: ${labels.join("; ")}` });
  }

  /**
   * Dissolve a trust — base plan or scenario-added. The lever reads the WORKING
   * tree, so it reaches everything a draft cannot see: an account or liability
   * retitled into this trust after it was created, a will bequest or another
   * trust's beneficiary list naming it, and a CLT's auto-emitted
   * remainder-interest gift.
   *
   * A base-plan trust never funded here has no draft, which is the same thing
   * as having funded nothing: every account falls through to the lever's
   * "return it to the grantor" rule, and `setTrusts` is a harmless no-op.
   *
   * Planned gifts drops every gift the lever clears, so the list never shows a
   * gift into a trust that is gone.
   */
  function removeTrust(trust: EntitySummary) {
    const entity = (clientData.entities ?? []).find((e) => e.id === trust.id) ?? trust;
    const draft = trusts.find((t) => t.entity.id === trust.id);
    const originals = new Map((draft?.fundedOriginals ?? []).map((a) => [a.id, a]));
    const clearedGiftIds = new Set<string>();
    for (const m of buildDissolveTrustMutations(clientData, entity)) {
      if (m.kind === "gift-upsert" && m.value === null) clearedGiftIds.add(m.id);
      // A trust funded in THIS session knows each account's exact prior owners.
      // Restoring them beats the lever's "return it to the grantor" rule, which
      // would hand a 50/50 joint account entirely to one spouse. Swapped in
      // place so the lever's ordering — entity delete last — is preserved.
      //
      // A revert fires only for an account the lever still sees as this trust's.
      // One funded here and since retitled elsewhere is left alone rather than
      // clobbered back to its pre-funding owners.
      // The revert carries the same `removedRefId` declaration the lever's
      // retitle did. Without it exactly this account reports base-savable on its
      // own and Save-to-base writes half a trust removal to the real record.
      const original = m.kind === "account-upsert" ? originals.get(m.id) : undefined;
      onChange(original ? buildRevertFundingMutation(original, entity.id) : m);
    }
    if (clearedGiftIds.size > 0) setGifts((gs) => gs.filter((g) => !clearedGiftIds.has(g.id)));
    setTrusts((ts) => ts.filter((t) => t.entity.id !== trust.id));
    setSelection({ kind: "overview" });
  }

  // ── Revocable living trusts ─────────────────────────────────────────────────
  // Not entities: an account joins one by carrying its name, so every write is
  // an `account-upsert` on the WORKING tree's accounts.
  const railRevocableTrusts = useMemo(
    () => revocableTrustRows(baseClientData.accounts, clientData.accounts),
    [baseClientData.accounts, clientData.accounts],
  );

  /** An added trust with no accounts left no longer exists (it is only a tag),
   *  so its pane gives way to the overview; a base trust lists with 0 accounts. */
  function setRevocableMembership(name: string, accountIds: ReadonlySet<string>) {
    for (const m of buildRevocableMembershipMutations(clientData.accounts, name, accountIds)) onChange(m);
    const isBase = railRevocableTrusts.some((r) => r.name === name && r.isBase);
    if (accountIds.size === 0 && !isBase) setSelection({ kind: "overview" });
  }

  /** The pane validates `to` (non-blank, not another trust's name) before calling. */
  function renameRevocableTrust(from: string, to: string) {
    for (const m of buildRevocableRenameMutations(clientData.accounts, from, to)) onChange(m);
    setSelection({ kind: "revocable", name: to.trim() });
  }

  function removeRevocableTrust(name: string) {
    setRevocableMembership(name, new Set());
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
        label: trustTypeLabel(t),
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

  function addCharity(name: string, charityType: "public" | "private") {
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = crypto.randomUUID();
    onChange({
      kind: "external-beneficiary-upsert",
      id,
      value: { id, name: trimmed, kind: "charity", charityType },
    });
    setSelection({ kind: "charity", id });
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

  const summary: EstateSummary = useMemo(() => {
    const giftCount = gifts.filter((g) => g.enabled !== false).length;
    const trustCount = railTrusts.length + railRevocableTrusts.length;
    const charityCount = railCharities.length;
    return {
      giftCount,
      trustCount,
      charityCount,
      isEmpty: giftCount === 0 && trustCount === 0 && charityCount === 0,
    };
  }, [gifts, railTrusts, railRevocableTrusts, railCharities]);

  return {
    clientData,
    selection, setSelection, notice,
    gifts, baseGiftIds, toggleGift, upsertGift, deleteGift,
    editing, setEditing, adding, setAdding,
    taxInflationRate, annualExclusionByYear,
    railTrusts, railRevocableTrusts, addTrust, addFunding, removeTrust,
    setRevocableMembership, renameRevocableTrust, removeRevocableTrust,
    railCharities, addCharity, updateCharity, removeCharity,
    summary,
  };
}
