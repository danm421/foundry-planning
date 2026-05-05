import type { Gift, GiftEvent, FamilyMember } from "@/engine/types";

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

function resolveGiftRecipient(
  gift: Gift,
  input: BuildRecipientDrilldownInput,
): ResolvedRecipient | null {
  if (gift.recipientFamilyMemberId) {
    const fm = input.familyMembersById.get(gift.recipientFamilyMemberId);
    if (!fm) return null;
    return {
      kind: "family",
      key: `family:${gift.recipientFamilyMemberId}`,
      label: `${fm.firstName} ${fm.lastName ?? ""}`.trim(),
    };
  }
  if (gift.recipientEntityId) {
    const ent = input.entitiesById.get(gift.recipientEntityId);
    if (!ent) return null;
    return {
      kind: "entity",
      key: `entity:${gift.recipientEntityId}`,
      label: ent.name,
    };
  }
  if (gift.recipientExternalBeneficiaryId) {
    const ext = input.externalBeneficiariesById.get(
      gift.recipientExternalBeneficiaryId,
    );
    if (!ext) return null;
    return {
      kind: "external",
      key: `external:${gift.recipientExternalBeneficiaryId}`,
      label: ext.name,
    };
  }
  return null;
}

function resolveAssetEventRecipient(
  ev: Extract<GiftEvent, { kind: "asset" }>,
  input: BuildRecipientDrilldownInput,
): ResolvedRecipient | null {
  if (!ev.recipientEntityId) return null;
  const ent = input.entitiesById.get(ev.recipientEntityId);
  if (!ent) return null;
  return {
    kind: "entity",
    key: `entity:${ev.recipientEntityId}`,
    label: ent.name,
  };
}

function isCharityRecipient(
  gift: Gift,
  input: BuildRecipientDrilldownInput,
): boolean {
  if (!gift.recipientExternalBeneficiaryId) return false;
  return (
    input.externalBeneficiariesById.get(gift.recipientExternalBeneficiaryId)
      ?.kind === "charity"
  );
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

  const giftsThisYear = input.gifts.filter((g) => g.year === input.year);
  giftsThisYear.forEach((g, i) => {
    const rec = resolveGiftRecipient(g, input);
    if (!rec) return;
    const charity = isCharityRecipient(g, input);
    const exclusion = charity
      ? 0
      : g.grantor === "joint"
        ? input.annualExclusion * 2
        : input.annualExclusion;
    const taxable = charity ? 0 : Math.max(0, g.amount - exclusion);
    addRow(rec, {
      description: `Gift ${i + 1}`,
      amount: g.amount,
      giftValue: g.amount,
      exclusion,
      taxableGift: taxable,
    });
  });

  // Asset GiftEvents — engine values them at amountOverride or accountValue × percent.
  // Cash and liability series come through legacy `gifts[]`, so we only render assets here.
  const eventsThisYear = input.giftEvents.filter(
    (ev) => ev.year === input.year,
  );
  let assetIdx = 0;
  for (const ev of eventsThisYear) {
    if (ev.kind !== "asset") continue;
    const rec = resolveAssetEventRecipient(ev, input);
    if (!rec) continue;
    const value =
      ev.amountOverride ??
      input.accountValueAtYear(ev.accountId, ev.year) * ev.percent;
    assetIdx += 1;
    addRow(rec, {
      description: `Asset gift ${assetIdx}`,
      amount: value,
      giftValue: value,
      exclusion: 0,
      taxableGift: value,
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
