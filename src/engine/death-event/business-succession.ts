import type {
  Account, DeathTransfer, EntitySummary, FamilyMember, Will, WillBequest,
} from "../types";
import { isBusinessEntity } from "@/lib/estate/in-estate-weights";
import { businessConsolidatedValue } from "./business-value";
import { type ExternalBeneficiarySummary, firesAtDeath } from "./shared";

/** entity_owners succession: the deceased's rows for one entity move to the
 *  resolved successors. successors is empty for a non-family recipient
 *  (charity / external / trust) — the value exits the household. */
export interface BusinessOwnerSuccession {
  entityId: string;
  removeFamilyMemberId: string;
  successors: Array<{ familyMemberId: string; percent: number }>;
}

export interface BusinessSuccessionResult {
  transfers: DeathTransfer[];
  ownerUpdates: BusinessOwnerSuccession[];
  basisUpdates: Array<{ entityId: string; newBasis: number }>;
  warnings: string[];
}

interface ResolvedRecipient {
  recipientKind: DeathTransfer["recipientKind"];
  recipientId: string | null;
  recipientLabel: string;
  via: DeathTransfer["via"];
  /** Fraction of the deceased's share this recipient takes (residuary splits). */
  fraction: number;
  /** entity_owners successor for a family-member/spouse recipient; null for
   *  non-family recipients (rows removed, value exits the household). */
  successorFmId: string | null;
}

/** Deceased's entity_owners fraction. Mirrors estate-tax.ts deceasedBusinessShare:
 *  legacy owners == null → joint convention (50% first / 100% final). */
function deceasedShare(
  entity: EntitySummary, deceasedFmId: string | null, deathOrder: 1 | 2,
): { share: number; legacy: boolean } {
  if (entity.owners == null) {
    return { share: deathOrder === 1 ? 0.5 : 1, legacy: true };
  }
  if (deceasedFmId == null) return { share: 0, legacy: false };
  const share = entity.owners
    .filter((o) => o.familyMemberId === deceasedFmId)
    .reduce((s, o) => s + (o.percent ?? 0), 0);
  return { share, legacy: false };
}

/** Resolve who receives a business interest: will entity-bequest → will
 *  residuary → fallback (spouse → children → other heirs). */
function resolveBusinessRecipient(input: {
  entity: EntitySummary;
  will: Will | null;
  deceased: "client" | "spouse";
  deathOrder: 1 | 2;
  survivorFmId: string | null;
  familyMembers: FamilyMember[];
  warnings: string[];
}): ResolvedRecipient[] {
  const { entity, will, deceased, deathOrder, survivorFmId, familyMembers, warnings } = input;
  const deceasedWill = will && will.grantor === deceased ? will : null;

  const mapRecipient = (
    kind: WillBequest["recipients"][number]["recipientKind"],
    id: string | null,
    fraction: number,
  ): ResolvedRecipient => {
    if (kind === "spouse") {
      return { recipientKind: "spouse", recipientId: survivorFmId,
        recipientLabel: "Spouse", via: "will", fraction, successorFmId: survivorFmId };
    }
    if (kind === "family_member") {
      const fm = familyMembers.find((f) => f.id === id);
      return { recipientKind: "family_member", recipientId: id,
        recipientLabel: fm ? `${fm.firstName} ${fm.lastName}`.trim() : "Heir",
        via: "will", fraction, successorFmId: id };
    }
    if (kind === "entity") {
      // successorFmId is null — no entity_owners succession is recorded; the
      // interest leaves the household. Warn so the advisor is aware.
      warnings.push(`business_bequest_to_entity: ${id ?? entity.id}`);
      return { recipientKind: "entity", recipientId: id, recipientLabel: "Entity (trust)",
        via: "will", fraction, successorFmId: null };
    }
    return { recipientKind: "external_beneficiary", recipientId: id,
      recipientLabel: "External", via: "will", fraction, successorFmId: null };
  };

  // 1. Specific will bequest naming this entity.
  if (deceasedWill) {
    const bequest = deceasedWill.bequests.find(
      (b) => b.kind === "asset" && b.assetMode === "specific" && b.entityId === entity.id
        && firesAtDeath(b, deathOrder),
    );
    if (bequest) {
      return bequest.recipients.map((rec) =>
        mapRecipient(rec.recipientKind, rec.recipientId, rec.percentage / 100));
    }
  }

  // 2. Will residuary clause. Primary tier only — contingent-tier residuary
  //    for final death is a deferred refinement (see future-work).
  if (deceasedWill && (deceasedWill.residuaryRecipients?.length ?? 0) > 0) {
    const recs = deceasedWill.residuaryRecipients!.filter(
      (r) => (r.tier ?? "primary") === "primary");
    if (recs.length > 0) {
      const totalPct = recs.reduce((s, r) => s + r.percentage, 0) || 100;
      return recs.map((r) =>
        ({ ...mapRecipient(r.recipientKind, r.recipientId, r.percentage / totalPct),
           via: "will_residuary" as const }));
    }
  }

  // 3. Fallback: spouse → children → other heirs.
  if (survivorFmId != null) {
    return [{ recipientKind: "spouse", recipientId: survivorFmId,
      recipientLabel: "Spouse", via: "fallback_spouse", fraction: 1,
      successorFmId: survivorFmId }];
  }
  const children = familyMembers.filter(
    (f) => f.relationship === "child" && f.role !== "client" && f.role !== "spouse");
  if (children.length > 0) {
    const per = 1 / children.length;
    return children.map((c) => ({ recipientKind: "family_member" as const,
      recipientId: c.id, recipientLabel: `${c.firstName} ${c.lastName}`.trim(),
      via: "fallback_children" as const, fraction: per, successorFmId: c.id }));
  }
  return [{ recipientKind: "system_default", recipientId: null,
    recipientLabel: "Other Heirs", via: "fallback_other_heirs", fraction: 1,
    successorFmId: null }];
}

export function applyBusinessSuccession(input: {
  deceased: "client" | "spouse";
  deceasedFmId: string | null;
  survivorFmId: string | null;
  deathOrder: 1 | 2;
  entities: EntitySummary[];
  accounts: Account[];
  accountBalances: Record<string, number>;
  entityAccountSharesEoY: Map<string, Map<string, number>> | undefined;
  will: Will | null;
  familyMembers: FamilyMember[];
  externalBeneficiaries: ExternalBeneficiarySummary[]; // reserved for future external-recipient labeling; not yet consumed
  year: number;
}): BusinessSuccessionResult {
  const transfers: DeathTransfer[] = [];
  const ownerUpdates: BusinessOwnerSuccession[] = [];
  const basisUpdates: Array<{ entityId: string; newBasis: number }> = [];
  const warnings: string[] = [];

  for (const entity of input.entities) {
    if (!isBusinessEntity(entity)) continue;
    const { share, legacy } = deceasedShare(entity, input.deceasedFmId, input.deathOrder);
    if (share <= 1e-9) continue;
    if (legacy) warnings.push(`business_legacy_owners_joint: ${entity.id}`);

    const consolidated = businessConsolidatedValue(
      entity, input.accounts, input.accountBalances, input.entityAccountSharesEoY);
    if (consolidated <= 0) continue;

    const transferredValue = consolidated * share;
    const recipients = resolveBusinessRecipient({
      entity, will: input.will, deceased: input.deceased,
      deathOrder: input.deathOrder, survivorFmId: input.survivorFmId,
      familyMembers: input.familyMembers, warnings,
    });

    // Proportional basis on the transferred portion.
    // entity.basis tracks the flat operating-value basis only; account-slice
    // basis is carried on each Account and does not flow through this field.
    // That is why transfer.basis and the §1014 step-up use flatValue (entity.value)
    // rather than businessConsolidatedValue — the two bases are accounted separately.
    const oldBasis = entity.basis ?? 0;
    const flatValue = entity.value ?? 0;

    const successors: BusinessOwnerSuccession["successors"] = [];
    for (const rec of recipients) {
      transfers.push({
        year: input.year, deathOrder: input.deathOrder, deceased: input.deceased,
        sourceAccountId: null, sourceAccountName: entity.name ?? "Business",
        sourceLiabilityId: null, sourceLiabilityName: null,
        sourceEntityId: entity.id,
        via: rec.via, recipientKind: rec.recipientKind, recipientId: rec.recipientId,
        recipientLabel: rec.recipientLabel,
        amount: transferredValue * rec.fraction,
        basis: flatValue * share * rec.fraction,
        resultingAccountId: null, resultingLiabilityId: null,
      });
      if (rec.successorFmId != null) {
        // percent is the successor's ABSOLUTE entity-ownership share:
        // deceased's share of the entity × this recipient's fraction of that share.
        successors.push({ familyMemberId: rec.successorFmId, percent: share * rec.fraction });
      }
    }

    // Only record an ownerUpdates entry when the entity actually has an owners
    // array. Legacy entities (owners == null) use the joint convention but have
    // no owner rows to update — the orchestrator's mutatedEntities map silently
    // skips entries for null-owners entities anyway, but there's no point
    // emitting a dead entry. basisUpdates is unconditional: the §1014 step-up
    // on the deceased's share is still correct for a legacy entity even though
    // there is no owner table to rewrite.
    if (input.deceasedFmId != null && entity.owners != null) {
      ownerUpdates.push({
        entityId: entity.id, removeFamilyMemberId: input.deceasedFmId, successors,
      });
    }

    // §1014 step-up on the deceased's flat-value share.
    basisUpdates.push({
      entityId: entity.id, newBasis: oldBasis * (1 - share) + flatValue * share,
    });
  }

  // Warn on will bequests whose subject names a non-business entity (a trust —
  // inert here, trusts route via grantor-succession) or a missing entity.
  const deceasedWill =
    input.will && input.will.grantor === input.deceased ? input.will : null;
  const businessIds = new Set(
    input.entities.filter(isBusinessEntity).map((e) => e.id));
  for (const b of deceasedWill?.bequests ?? []) {
    if (b.entityId != null && !businessIds.has(b.entityId)) {
      warnings.push(`business_bequest_names_non_business: ${b.id}`);
    }
  }

  return { transfers, ownerUpdates, basisUpdates, warnings };
}
