import type { Gift, GiftEvent, FamilyMember, EntitySummary } from "@/engine/types";
import {
  toCanonicalGifts,
  treatCanonicalGift,
  type CanonicalGift,
} from "./normalize-gifts";

export interface RecipientDrilldownRow {
  description: string;
  amount: number;
  giftValue: number;
  exclusion: number;
  taxableGift: number;
}

export interface RecipientGroup {
  label: string;
  rows: RecipientDrilldownRow[];
  subtotal: {
    amount: number;
    giftValue: number;
    exclusion: number;
    taxableGift: number;
  };
}

export interface BuildRecipientDrilldownInput {
  year: number;
  gifts: Gift[];
  giftEvents: GiftEvent[];
  entities: EntitySummary[];
  familyMembersById: Map<
    string,
    Pick<FamilyMember, "firstName" | "lastName">
  >;
  entitiesById: Map<string, { name: string }>;
  externalBeneficiariesById: Map<
    string,
    { name: string; kind: "charity" | "individual" }
  >;
  annualExclusion: number;
  accountValueAtYear: (accountId: string, year: number) => number;
}

type GroupKind = "family" | "entity" | "external";

interface ResolvedRecipient {
  kind: GroupKind;
  key: string;
  label: string;
}

const INDIVIDUAL_OTHER_KEY = "external:__individual_other__";

function resolveCanonicalRecipient(
  cg: CanonicalGift,
  input: BuildRecipientDrilldownInput,
): ResolvedRecipient | null {
  if (cg.recipientEntityId) {
    const ent = input.entitiesById.get(cg.recipientEntityId);
    if (!ent) return null;
    return {
      kind: "entity",
      key: `entity:${cg.recipientEntityId}`,
      label: ent.name,
    };
  }
  if (cg.recipientFamilyMemberId) {
    const fm = input.familyMembersById.get(cg.recipientFamilyMemberId);
    if (!fm) return null;
    return {
      kind: "family",
      key: `family:${cg.recipientFamilyMemberId}`,
      label: `${fm.firstName} ${fm.lastName ?? ""}`.trim(),
    };
  }
  if (cg.recipientExternalBeneficiaryId) {
    const ext = input.externalBeneficiariesById.get(
      cg.recipientExternalBeneficiaryId,
    );
    if (!ext) return null;
    return {
      kind: "external",
      key: `external:${cg.recipientExternalBeneficiaryId}`,
      label: ext.name,
    };
  }
  // Recipient-less cash (e.g. an individual-owned life-insurance premium gift)
  // — the cash leaves the household to an unmodeled individual.
  return {
    kind: "external",
    key: INDIVIDUAL_OTHER_KEY,
    label: "Individual (other)",
  };
}

function describeCanonical(
  cg: CanonicalGift,
  input: BuildRecipientDrilldownInput,
): string {
  if (cg.sourcePolicyAccountId != null) return "Life-insurance premium gift";
  if (cg.eventKind === "clt_remainder_interest" && cg.recipientEntityId) {
    const ent = input.entitiesById.get(cg.recipientEntityId);
    return `CLT ${ent?.name ?? "remainder"} – remainder interest`;
  }
  // Non-premium giftEvents are the asset / business-interest transfers (cash
  // series carry sourcePolicyAccountId only when synthesized from a policy).
  if (cg.source === "event") return "Asset gift";
  return "Gift";
}

const GROUP_RANK: Record<GroupKind, number> = {
  family: 0,
  entity: 1,
  external: 2,
};

export function buildRecipientDrilldown(
  input: BuildRecipientDrilldownInput,
): RecipientGroup[] {
  const groups = new Map<
    string,
    { kind: GroupKind; label: string; rows: RecipientDrilldownRow[] }
  >();

  function addRow(rec: ResolvedRecipient, row: RecipientDrilldownRow): void {
    const existing = groups.get(rec.key);
    if (existing) existing.rows.push(row);
    else groups.set(rec.key, { kind: rec.kind, label: rec.label, rows: [row] });
  }

  const canonical = toCanonicalGifts(input.gifts, input.giftEvents, {
    entities: input.entities,
    externalBeneficiaries: [...input.externalBeneficiariesById.entries()].map(
      ([id, v]) => ({ id, kind: v.kind }),
    ),
    accountValueAtYear: input.accountValueAtYear,
  }).filter((cg) => cg.year === input.year);

  for (const cg of canonical) {
    const rec = resolveCanonicalRecipient(cg, input);
    if (!rec) continue;
    const t = treatCanonicalGift(cg, input.annualExclusion);
    addRow(rec, {
      description: describeCanonical(cg, input),
      amount: cg.amount,
      giftValue: cg.amount,
      exclusion: t.annualExcluded + t.charitableExcluded,
      taxableGift: t.lifetimeUsed,
    });
  }

  return Array.from(groups.values())
    .sort((a, b) => {
      const r = GROUP_RANK[a.kind] - GROUP_RANK[b.kind];
      return r !== 0 ? r : a.label.localeCompare(b.label);
    })
    .map(({ label, rows }) => {
      const subtotal = rows.reduce(
        (acc, r) => ({
          amount: acc.amount + r.amount,
          giftValue: acc.giftValue + r.giftValue,
          exclusion: acc.exclusion + r.exclusion,
          taxableGift: acc.taxableGift + r.taxableGift,
        }),
        { amount: 0, giftValue: 0, exclusion: 0, taxableGift: 0 },
      );
      return { label, rows, subtotal };
    });
}
