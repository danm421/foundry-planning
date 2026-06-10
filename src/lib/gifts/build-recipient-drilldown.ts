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

/**
 * §2503(b): a canonical gift is annual-exclusion-eligible — i.e.
 * `treatCanonicalGift` would apply a (poolable) annual exclusion — for cash to a
 * natural person (family member / external individual / unmodeled individual)
 * and for Crummey-eligible cash to a trust. Asset / business-interest transfers
 * (forced `useCrummeyPowers: false` in normalize-gifts) and charitable gifts are
 * NOT AE-eligible. Mirror of `isAnnualExclusionEligible` in
 * src/engine/gift-ledger.ts — keep the two in lockstep.
 */
function isAnnualExclusionEligible(cg: CanonicalGift): boolean {
  if (cg.recipientEntityId) {
    return cg.useCrummeyPowers && cg.crummeyBeneficiaryCount > 0;
  }
  if (cg.recipientExternalBeneficiaryId) {
    return cg.external?.kind !== "charity";
  }
  // Family member or unmodeled individual — both draw a single AE.
  return true;
}

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

  // §2503(b): ONE annual exclusion per donee per grantor per year (AE ×
  // Crummey-beneficiary-count for a trust). Pool AE-eligible cash to the same
  // donee/grantor, compute the shared exclusion once on the aggregate (matching
  // compute-ledger.ts), then ALLOCATE it across that group's display rows
  // earliest-row-first so per-row exclusion sums to the group exclusion. Non-AE
  // transfers (asset / business / non-Crummey trust / charitable) are not pooled
  // — each is treated independently so a mixed group never nets a cash exclusion
  // against an asset amount. Grantor is part of the pool key because §2513 joint
  // gifts split into client + spouse half-gifts that each claim their own AE.
  //
  // Aggregate each pool's eligible amount, keeping the first eligible gift as a
  // representative — per-group context (entity/Crummey count, external kind) is
  // identical within a pool, so only the summed `amount` drives the cap.
  const pools = new Map<string, { rep: CanonicalGift; amount: number }>();
  for (const cg of canonical) {
    if (!isAnnualExclusionEligible(cg)) continue;
    const rec = resolveCanonicalRecipient(cg, input);
    if (!rec) continue;
    const key = `${rec.key}|${cg.grantor}`;
    const existing = pools.get(key);
    if (existing) existing.amount += cg.amount;
    else pools.set(key, { rep: cg, amount: cg.amount });
  }
  // Convert each pooled aggregate into its shared exclusion via the same
  // `treatCanonicalGift` the ledger uses (the AE × beneficiaryCount cap lives in
  // computeGiftTaxTreatment). This running balance is drained earliest-row-first
  // as rows are emitted below.
  const remainingExclusionByKey = new Map<string, number>();
  for (const [key, { rep, amount }] of pools) {
    remainingExclusionByKey.set(
      key,
      treatCanonicalGift({ ...rep, amount }, input.annualExclusion).annualExcluded,
    );
  }

  for (const cg of canonical) {
    const rec = resolveCanonicalRecipient(cg, input);
    if (!rec) continue;

    let exclusion: number;
    let taxableGift: number;
    if (isAnnualExclusionEligible(cg)) {
      // Allocate from the donee/grantor pool earliest-row-first.
      const key = `${rec.key}|${cg.grantor}`;
      const remaining = remainingExclusionByKey.get(key) ?? 0;
      exclusion = Math.min(cg.amount, remaining);
      remainingExclusionByKey.set(key, remaining - exclusion);
      taxableGift = cg.amount - exclusion;
    } else {
      // Non-AE rows (asset / business / non-Crummey trust / charitable) carry
      // their own per-row treatment — charitable nets to a charitable exclusion.
      const t = treatCanonicalGift(cg, input.annualExclusion);
      exclusion = t.annualExcluded + t.charitableExcluded;
      taxableGift = t.lifetimeUsed;
    }

    addRow(rec, {
      description: describeCanonical(cg, input),
      amount: cg.amount,
      giftValue: cg.amount,
      exclusion,
      taxableGift,
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
