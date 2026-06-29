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
  const [draft, setDraft] = useState<EstateFlowGift | null>(() =>
    toEditingDraft(props.editingGift ?? null, props.editingSeries ?? null),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (!draft) throw new Error("Please complete the gift before saving.");

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
          annualAmount: typeof row.annualAmount === "string" ? parseFloat(row.annualAmount) : row.annualAmount,
          amountMode: row.amountMode ?? "fixed",
          inflationAdjust: row.inflationAdjust,
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
        amount: row.amount != null ? (typeof row.amount === "string" ? parseFloat(row.amount) : row.amount) : null,
        grantor: row.grantor,
        recipientEntityId: row.recipientEntityId ?? null,
        recipientFamilyMemberId: row.recipientFamilyMemberId ?? null,
        recipientExternalBeneficiaryId: row.recipientExternalBeneficiaryId ?? null,
        accountId: row.accountId ?? null,
        percent: row.percent != null ? (typeof row.percent === "string" ? parseFloat(row.percent) : row.percent) : null,
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
          trusts: props.entities
            .filter((e) => e.entityType === "trust" && e.isIrrevocable === true)
            .map((e) => ({ id: e.id, name: e.name })),
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
          .map((a) => ({ id: a.id, name: a.name }))}
        hasSpouse={props.hasSpouse}
        annualExclusionByYear={props.annualExclusionByYear}
        editing={draft}
        onChange={setDraft}
      />
      {error && <p data-testid="gift-error" className="mt-3 text-sm text-crit">{error}</p>}
    </DialogShell>
  );
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
    };
  }
  if (!g) return null;
  const recipient: GiftRecipientRef =
    g.recipientEntityId ? { kind: "entity", id: g.recipientEntityId }
    : g.recipientFamilyMemberId ? { kind: "family_member", id: g.recipientFamilyMemberId }
    : { kind: "external_beneficiary", id: g.recipientExternalBeneficiaryId ?? "" };
  if (g.accountId) return { kind: "asset-once", id: g.id, year: g.year, accountId: g.accountId, percent: g.percent ?? 0, grantor: g.grantor, recipient };
  return { kind: "cash-once", id: g.id, year: g.year, amount: g.amount ?? 0, grantor: g.grantor, recipient, crummey: g.useCrummeyPowers };
}
