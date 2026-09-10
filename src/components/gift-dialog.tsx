"use client";

import { useState } from "react";
import DialogShell from "@/components/dialog-shell";
import GiftForm from "@/components/gift-form";
import type {
  Gift,
  GiftSeriesLite,
  FamilyMember,
  ExternalBeneficiary,
  Entity,
  AccountLite,
} from "@/components/family-view";
import type { EstateFlowGift, GiftRecipientRef } from "@/lib/estate/estate-flow-gifts";
import { discountAppliesToDraft } from "@/lib/gifts/discount-applicability";
import {
  giftDraftToRow,
  giftDraftToSeriesRow,
} from "@/app/(app)/clients/[id]/details/family/family-scenario-rows";

export interface GiftDialogProps {
  clientId: string;
  scenarioId: string;
  hasSpouse: boolean;
  members: FamilyMember[];
  externals: ExternalBeneficiary[];
  entities: Entity[];
  accounts: AccountLite[];
  annualExclusionByYear: Record<number, number>;
  /** Existing one-time gift to edit, or existing series to edit, or null to add. */
  editingGift?: Gift | null;
  editingSeries?: GiftSeriesLite | null;
  /**
   * Ids this page renders that exist ONLY as `scenario_changes` rows — the
   * solver's "save as scenario" writes `entity` / `gift` adds and never touches
   * the base tables, and the trust picker and gift list here both read the
   * overlay, so either can be scenario-only.
   *
   * The base gift routes structurally cannot accept such a save: they validate
   * `recipientEntityId` against base `entities` (the 400 "Recipient entity not
   * found for this client"), the row lookup behind that 400 would 404, and
   * `gifts.recipient_entity_id` carries a real FK to `entities(id)` that would
   * reject the write even if both checks were relaxed. So these saves go to the
   * scenario changes writer — the sanctioned path for non-base mutations.
   */
  scenarioOnly?: { giftIds: string[]; entityIds: string[] };
  onClose: () => void;
  onSavedGift: (g: Gift) => void;
  onSavedSeries: (s: GiftSeriesLite) => void;
  /** A kind change re-created the row under a new id, so the old one is gone —
   *  see `savesInPlace`. Fires before the matching onSaved* callback. */
  onRemovedGift: (id: string) => void;
  onRemovedSeries: (id: string) => void;
}

export default function GiftDialog(props: GiftDialogProps) {
  const editing = props.editingGift ?? props.editingSeries ?? null;
  // The gift form offers a trust as a recipient only when it is irrevocable,
  // and gates the valuation-discount field on the same list.
  const irrevocableTrusts = props.entities.filter(
    (e) => e.entityType === "trust" && e.isIrrevocable === true,
  );
  const irrevocableTrustIds = new Set(irrevocableTrusts.map((e) => e.id));
  // Stable form seed. The live `draft` (below) must NOT be fed back as the seed:
  // GiftForm re-seeds every field from `editing`, so passing the in-progress
  // draft would fight the advisor's own typing.
  const initialDraft = useState(() =>
    toEditingDraft(props.editingGift ?? null, props.editingSeries ?? null),
  )[0];
  const [draft, setDraft] = useState<EstateFlowGift | null>(initialDraft);
  // Why the form is withholding a draft, so a refused save names the field.
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * True when the edit can be a PATCH of the row the advisor opened.
   *
   * It can't be when the advisor changed the gift's *shape*: Frequency moves
   * the row between two tables (`gifts` and `gift_series`), and Funding or a
   * different source asset rewrites `accountId`, which the gift PATCH schema
   * omits on purpose — re-pointing a row would strand the liability row the
   * POST route auto-bundles with an asset transfer. Those saves create the
   * replacement first and delete the original after, so the new row is built
   * by the POST route with the bundling and ownership writes its own shape
   * needs. The gift keeps its meaning, not its id.
   */
  function savesInPlace(d: EstateFlowGift): boolean {
    if (d.kind === "series") return props.editingSeries != null;
    if (!props.editingGift) return false;
    const savedAccountId = props.editingGift.accountId ?? null;
    return d.kind === "asset-once"
      ? savedAccountId === d.accountId
      : savedAccountId === null;
  }

  const scenarioOnlyGiftIds = new Set(props.scenarioOnly?.giftIds ?? []);
  const scenarioOnlyEntityIds = new Set(props.scenarioOnly?.entityIds ?? []);
  const editingScenarioOnlyRow =
    (props.editingGift != null && scenarioOnlyGiftIds.has(props.editingGift.id)) ||
    (props.editingSeries != null && scenarioOnlyGiftIds.has(props.editingSeries.id));

  /**
   * True when this save has no base row to land on — the gift being edited
   * lives only in the scenario, or it is aimed at a trust that does. Either way
   * the base gift routes cannot store it (see `scenarioOnly` above).
   */
  function isScenarioOnly(d: EstateFlowGift): boolean {
    if (editingScenarioOnlyRow) return true;
    return d.recipient.kind === "entity" && scenarioOnlyEntityIds.has(d.recipient.id);
  }

  /**
   * Write the gift as a `scenario_changes` row instead of a base table row.
   *
   * The draft GiftForm already produced is exactly the payload shape the
   * overlay reads back (`partitionGiftChanges` → `giftDraftToRow`), so it goes
   * over the wire as-is. Editing keeps the id, which lets `applyEntityEdit`'s
   * edit-of-add collapse fold the new fields into the existing `add` row rather
   * than stacking a parallel `edit` row beside it. A shape change mints a new
   * id, so it adds the replacement and removes the original — the same
   * "keeps its meaning, not its id" rule `savesInPlace` applies to base rows.
   */
  async function saveAsScenarioChange(
    d: EstateFlowGift,
    discountToSend: number | null | undefined,
  ) {
    const url = `/api/clients/${props.clientId}/scenarios/${props.scenarioId}/changes`;
    // Key order is load-bearing: the unsaved-changes diff keys drafts by
    // JSON.stringify, and `valuationDiscount` is the agreed LAST KEY. Assigning
    // an existing key keeps its position, so the spread preserves the order
    // GiftForm emitted. `undefined` would be dropped by JSON.stringify and let
    // applyEntityEdit's merge keep a stale discount, so an advisor who cleared
    // the field sends an explicit null.
    const payload: Record<string, unknown> = { ...d };
    if (discountToSend !== undefined) payload.valuationDiscount = discountToSend;

    const staleId = props.editingGift?.id ?? props.editingSeries?.id ?? null;
    const inPlace = staleId === d.id;

    await postChange(
      url,
      inPlace
        ? { op: "edit", targetKind: "gift", targetId: d.id, desiredFields: payload }
        : { op: "add", targetKind: "gift", entity: payload },
    );
    if (!inPlace && staleId != null) {
      await postChange(url, { op: "remove", targetKind: "gift", targetId: staleId });
      if (props.editingGift) props.onRemovedGift(staleId);
      else if (props.editingSeries) props.onRemovedSeries(staleId);
    }

    // No row comes back from the changes writer, so rebuild the list entry from
    // the draft through the same mappers the page's overlay uses.
    const saved = payload as unknown as EstateFlowGift;
    if (saved.kind === "series") {
      const row = giftDraftToSeriesRow(saved);
      if (row) props.onSavedSeries(row);
    } else {
      const row = giftDraftToRow(saved);
      if (row) props.onSavedGift(row);
    }
  }

  async function postChange(url: string, body: Record<string, unknown>) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    }
  }

  /** Delete the row a shape change left behind. Runs AFTER the replacement is
   *  saved, so a failure here leaves a duplicate rather than losing the gift. */
  async function removeReplacedRow() {
    const staleGift = props.editingGift;
    const staleSeries = props.editingSeries;
    const url = staleGift
      ? `/api/clients/${props.clientId}/gifts/${staleGift.id}`
      : staleSeries
        ? `/api/clients/${props.clientId}/gifts/series/${staleSeries.id}?scenario=${props.scenarioId}`
        : null;
    if (!url) return;
    const res = await fetch(url, { method: "DELETE" });
    if (!res.ok) {
      throw new Error(
        "Saved the updated gift, but the original entry could not be removed. Refresh and delete it.",
      );
    }
    if (staleGift) props.onRemovedGift(staleGift.id);
    else if (staleSeries) props.onRemovedSeries(staleSeries.id);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (!draft) throw new Error(blockedReason ?? "Please complete the gift before saving.");
      const inPlace = savesInPlace(draft);
      // The discount field is on screen exactly when the shared rule admits the
      // gift's shape, so when it does the draft is authoritative: an advisor who
      // cleared it sends an explicit null. When it does not, the dialog has no
      // opinion — a PATCH omits the key so the routes leave the saved row alone,
      // and a re-create writes null because the replacement is a shape that
      // cannot carry a discount at all.
      //
      // A shape change that KEEPS the discount (asset -> asset, one-time ->
      // recurring) needs no special handling: the field is on screen on both
      // sides, so the seeded draft carries the value onto the replacement.
      const discountToSend = discountAppliesToDraft(draft, irrevocableTrustIds)
        ? draft.valuationDiscount ?? null
        : inPlace
          ? undefined
          : null;

      // A gift with no base row to land on never reaches the base gift routes;
      // one table's worth of shape handling below does not apply to it.
      if (isScenarioOnly(draft)) {
        await saveAsScenarioChange(draft, discountToSend);
        return;
      }

      if (draft.kind === "series") {
        const body: Record<string, unknown> = {
          grantor: draft.grantor,
          amountMode: draft.amountMode,
          startYear: draft.startYear,
          endYear: draft.endYear,
          annualAmount: draft.annualAmount,
          inflationAdjust: draft.inflationAdjust,
          useCrummeyPowers: draft.crummey,
        };
        if (discountToSend !== undefined) body.valuationDiscount = discountToSend;
        if (draft.recipient.kind === "entity") body.recipientEntityId = draft.recipient.id;
        if (draft.recipient.kind === "family_member") body.recipientFamilyMemberId = draft.recipient.id;
        if (draft.recipient.kind === "external_beneficiary") body.recipientExternalBeneficiaryId = draft.recipient.id;
        const url = inPlace
          ? `/api/clients/${props.clientId}/gifts/series/${props.editingSeries!.id}?scenario=${props.scenarioId}`
          : `/api/clients/${props.clientId}/gifts/series?scenario=${props.scenarioId}`;
        const res = await fetch(url, {
          method: inPlace ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
        const row = await res.json();
        if (!inPlace) await removeReplacedRow();
        props.onSavedSeries({
          id: row.id,
          grantor: row.grantor,
          recipientEntityId: row.recipientEntityId ?? null,
          recipientFamilyMemberId: row.recipientFamilyMemberId ?? null,
          recipientExternalBeneficiaryId: row.recipientExternalBeneficiaryId ?? null,
          startYear: row.startYear,
          endYear: row.endYear,
          annualAmount: numOrNull(row.annualAmount) ?? 0,
          amountMode: row.amountMode ?? "fixed",
          inflationAdjust: row.inflationAdjust,
          valuationDiscount: numOrNull(row.valuationDiscount),
          useCrummeyPowers: row.useCrummeyPowers,
        });
        return;
      }

      // One-time gift (cash-once or asset-once)
      const body: Record<string, unknown> = { year: draft.year, grantor: draft.grantor };
      if (draft.recipient.kind === "entity") body.recipientEntityId = draft.recipient.id;
      if (draft.recipient.kind === "family_member") body.recipientFamilyMemberId = draft.recipient.id;
      if (draft.recipient.kind === "external_beneficiary") body.recipientExternalBeneficiaryId = draft.recipient.id;

      if (draft.kind === "cash-once") {
        body.amount = draft.amount;
        body.useCrummeyPowers = draft.crummey;
      } else {
        body.accountId = draft.accountId;
        body.percent = draft.percent;
        body.useCrummeyPowers = false;
      }
      if (discountToSend !== undefined) body.valuationDiscount = discountToSend;

      const url = inPlace
        ? `/api/clients/${props.clientId}/gifts/${props.editingGift!.id}`
        : `/api/clients/${props.clientId}/gifts`;
      const res = await fetch(url, {
        method: inPlace ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      const row = await res.json();
      if (!inPlace) await removeReplacedRow();
      props.onSavedGift({
        id: row.id,
        year: row.year,
        amount: numOrNull(row.amount),
        grantor: row.grantor,
        recipientEntityId: row.recipientEntityId ?? null,
        recipientFamilyMemberId: row.recipientFamilyMemberId ?? null,
        recipientExternalBeneficiaryId: row.recipientExternalBeneficiaryId ?? null,
        accountId: row.accountId ?? null,
        percent: numOrNull(row.percent),
        valuationDiscount: numOrNull(row.valuationDiscount),
        useCrummeyPowers: row.useCrummeyPowers,
        notes: row.notes ?? null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogShell
      open
      onOpenChange={(o) => { if (!o) props.onClose(); }}
      title={editing ? "Edit gift" : "Add a gift"}
      size="md"
      primaryAction={{ label: editing ? "Save gift" : "Add gift", onClick: save, loading: saving }}
    >
      <GiftForm
        recipients={{
          trusts: irrevocableTrusts.map((e) => ({ id: e.id, name: e.name })),
          familyMembers: props.members.map((m) => ({
            id: m.id,
            firstName: m.firstName,
            lastName: m.lastName,
            roleLabel: m.role,
          })),
          externals: props.externals.map((x) => ({ id: x.id, name: x.name, kindLabel: x.kind })),
        }}
        accounts={props.accounts
          .filter((a) => a.ownerEntityId == null)
          .map((a) => ({ id: a.id, name: a.name, value: a.value, subType: a.subType }))}
        hasSpouse={props.hasSpouse}
        annualExclusionByYear={props.annualExclusionByYear}
        editing={initialDraft}
        onChange={(d, reason) => { setDraft(d); setBlockedReason(reason); }}
      />
      {error && <p data-testid="gift-error" className="mt-3 text-sm text-crit">{error}</p>}
    </DialogShell>
  );
}

/** Postgres `decimal` columns come back as strings. */
function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  return typeof v === "string" ? parseFloat(v) : (v as number);
}

/** Seed an EstateFlowGift from an existing DB gift/series for editing. */
function toEditingDraft(g: Gift | null, s: GiftSeriesLite | null): EstateFlowGift | null {
  if (s) {
    const seriesRecipient: GiftRecipientRef =
      s.recipientEntityId ? { kind: "entity", id: s.recipientEntityId }
      : s.recipientFamilyMemberId ? { kind: "family_member", id: s.recipientFamilyMemberId }
      : { kind: "external_beneficiary", id: s.recipientExternalBeneficiaryId ?? "" };
    return {
      kind: "series", id: s.id, startYear: s.startYear, endYear: s.endYear,
      annualAmount: s.annualAmount, amountMode: s.amountMode, inflationAdjust: s.inflationAdjust,
      grantor: s.grantor, recipient: seriesRecipient, crummey: s.useCrummeyPowers,
      // LAST KEY — GiftForm seeds its draft as `{...editing, ...base}` and keys
      // it by JSON.stringify, so a different order here than in its own `base`
      // re-fires onChange for an unchanged draft.
      valuationDiscount: s.valuationDiscount ?? undefined,
    };
  }
  if (!g) return null;
  const recipient: GiftRecipientRef =
    g.recipientEntityId ? { kind: "entity", id: g.recipientEntityId }
    : g.recipientFamilyMemberId ? { kind: "family_member", id: g.recipientFamilyMemberId }
    : { kind: "external_beneficiary", id: g.recipientExternalBeneficiaryId ?? "" };
  // `valuationDiscount` is the LAST KEY in both branches — see the note on the
  // series branch above.
  if (g.accountId) return { kind: "asset-once", id: g.id, year: g.year, accountId: g.accountId, percent: g.percent ?? 0, grantor: g.grantor, recipient, valuationDiscount: g.valuationDiscount ?? undefined };
  return { kind: "cash-once", id: g.id, year: g.year, amount: g.amount ?? 0, grantor: g.grantor, recipient, crummey: g.useCrummeyPowers, valuationDiscount: g.valuationDiscount ?? undefined };
}
