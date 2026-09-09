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
  onClose: () => void;
  onSavedGift: (g: Gift) => void;
  onSavedSeries: (s: GiftSeriesLite) => void;
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
  // GiftForm treats a non-null `editing` as "editing an existing gift" and locks
  // the Frequency/Funding toggles, so passing the in-progress draft would freeze
  // those controls the moment the form first becomes valid.
  const initialDraft = useState(() =>
    toEditingDraft(props.editingGift ?? null, props.editingSeries ?? null),
  )[0];
  const [draft, setDraft] = useState<EstateFlowGift | null>(initialDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (!draft) throw new Error("Please complete the gift before saving.");
      const discountApplies = discountAppliesToDraft(draft, irrevocableTrustIds);

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
        // The field is on screen for every series, so the draft is
        // authoritative — an explicit null clears a saved discount.
        if (discountApplies) body.valuationDiscount = draft.valuationDiscount ?? null;
        if (draft.recipient.kind === "entity") body.recipientEntityId = draft.recipient.id;
        if (draft.recipient.kind === "family_member") body.recipientFamilyMemberId = draft.recipient.id;
        if (draft.recipient.kind === "external_beneficiary") body.recipientExternalBeneficiaryId = draft.recipient.id;
        const url = props.editingSeries
          ? `/api/clients/${props.clientId}/gifts/series/${props.editingSeries.id}?scenario=${props.scenarioId}`
          : `/api/clients/${props.clientId}/gifts/series?scenario=${props.scenarioId}`;
        const res = await fetch(url, {
          method: props.editingSeries ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
        const row = await res.json();
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
      // See the series body above. A one-time cash gift to an individual shows
      // no discount field, so the row is left alone rather than cleared.
      if (discountApplies) body.valuationDiscount = draft.valuationDiscount ?? null;

      const url = props.editingGift
        ? `/api/clients/${props.clientId}/gifts/${props.editingGift.id}`
        : `/api/clients/${props.clientId}/gifts`;
      const res = await fetch(url, {
        method: props.editingGift ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      const row = await res.json();
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
        onChange={setDraft}
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
      // LAST KEY — see the JSON.stringify contract in estate-flow-gift-diff.ts.
      valuationDiscount: s.valuationDiscount ?? undefined,
    };
  }
  if (!g) return null;
  const recipient: GiftRecipientRef =
    g.recipientEntityId ? { kind: "entity", id: g.recipientEntityId }
    : g.recipientFamilyMemberId ? { kind: "family_member", id: g.recipientFamilyMemberId }
    : { kind: "external_beneficiary", id: g.recipientExternalBeneficiaryId ?? "" };
  // `valuationDiscount` is the LAST KEY in both branches — see the
  // JSON.stringify contract in estate-flow-gift-diff.ts.
  if (g.accountId) return { kind: "asset-once", id: g.id, year: g.year, accountId: g.accountId, percent: g.percent ?? 0, grantor: g.grantor, recipient, valuationDiscount: g.valuationDiscount ?? undefined };
  return { kind: "cash-once", id: g.id, year: g.year, amount: g.amount ?? 0, grantor: g.grantor, recipient, crummey: g.useCrummeyPowers, valuationDiscount: g.valuationDiscount ?? undefined };
}
