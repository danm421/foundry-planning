import type {
  Account, DeathTransfer, FamilyMember, Will, WillBequest,
} from "../types";
import { businessConsolidatedValue } from "./business-value";
import {
  deceasedBusinessAccountShare,
  type ExternalBeneficiarySummary,
  firesAtDeath,
} from "./shared";

/** Account-owner succession: the deceased's rows for one business account move
 *  to the resolved successors. successors is empty for a non-family recipient
 *  (charity / external / trust) — the value exits the household. */
export interface BusinessOwnerSuccession {
  accountId: string;
  removeFamilyMemberId: string;
  successors: Array<{ familyMemberId: string; percent: number }>;
}

export interface BusinessSuccessionResult {
  transfers: DeathTransfer[];
  ownerUpdates: BusinessOwnerSuccession[];
  basisUpdates: Array<{ accountId: string; newBasis: number }>;
  warnings: string[];
}

interface ResolvedRecipient {
  recipientKind: DeathTransfer["recipientKind"];
  recipientId: string | null;
  recipientLabel: string;
  via: DeathTransfer["via"];
  /** Fraction of the deceased's share this recipient takes (residuary splits). */
  fraction: number;
  /** account-owner successor for a family-member/spouse recipient; null for
   *  non-family recipients (rows removed, value exits the household). */
  successorFmId: string | null;
}

/** Resolve who receives a business interest: will entity-bequest → will
 *  residuary → fallback (spouse → children → other heirs). */
function resolveBusinessRecipient(input: {
  business: Account;
  will: Will | null;
  deceased: "client" | "spouse";
  deathOrder: 1 | 2;
  survivorFmId: string | null;
  familyMembers: FamilyMember[];
  warnings: string[];
}): ResolvedRecipient[] {
  const { business, will, deceased, deathOrder, survivorFmId, familyMembers, warnings } = input;
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
      // successorFmId is null — no account-owner succession is recorded; the
      // interest leaves the household. Warn so the advisor is aware.
      warnings.push(`business_bequest_to_entity: ${id ?? business.id}`);
      return { recipientKind: "entity", recipientId: id, recipientLabel: "Entity (trust)",
        via: "will", fraction, successorFmId: null };
    }
    return { recipientKind: "external_beneficiary", recipientId: id,
      recipientLabel: "External", via: "will", fraction, successorFmId: null };
  };

  // 1. Specific will bequest naming this business. The will-bequest schema
  //    still names the asset via the generic `entityId` field; migrating
  //    will-bequest target ids to accountId is deferred future work.
  if (deceasedWill) {
    const bequest = deceasedWill.bequests.find(
      (b) => b.kind === "asset" && b.assetMode === "specific" && b.entityId === business.id
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
  accounts: Account[];
  accountBalances: Record<string, number>;
  will: Will | null;
  familyMembers: FamilyMember[];
  externalBeneficiaries: ExternalBeneficiarySummary[]; // reserved for future external-recipient labeling; not yet consumed
  year: number;
}): BusinessSuccessionResult {
  const transfers: DeathTransfer[] = [];
  const ownerUpdates: BusinessOwnerSuccession[] = [];
  const basisUpdates: Array<{ accountId: string; newBasis: number }> = [];
  const warnings: string[] = [];

  const businesses = input.accounts.filter(
    (a) => a.category === "business" && a.parentAccountId == null,
  );

  for (const business of businesses) {
    const share = deceasedBusinessAccountShare(business, input.deceasedFmId);
    if (share <= 1e-9) continue;

    const consolidated = businessConsolidatedValue(
      business, input.accounts, input.accountBalances);
    if (consolidated <= 0) continue;

    const transferredValue = consolidated * share;
    const recipients = resolveBusinessRecipient({
      business, will: input.will, deceased: input.deceased,
      deathOrder: input.deathOrder, survivorFmId: input.survivorFmId,
      familyMembers: input.familyMembers, warnings,
    });

    // Proportional basis on the transferred portion. business.basis is the
    // operating-value basis of the business account itself; child-account
    // bases are carried on each child Account and do not flow through this
    // field. That is why transfer.basis and the §1014 step-up use
    // `business.value` rather than businessConsolidatedValue — the two bases
    // are accounted separately.
    const oldBasis = business.basis ?? 0;
    const flatValue = business.value ?? 0;

    const successors: BusinessOwnerSuccession["successors"] = [];
    for (const rec of recipients) {
      transfers.push({
        year: input.year, deathOrder: input.deathOrder, deceased: input.deceased,
        sourceAccountId: business.id, sourceAccountName: business.name,
        sourceLiabilityId: null, sourceLiabilityName: null,
        sourceEntityId: null,
        via: rec.via, recipientKind: rec.recipientKind, recipientId: rec.recipientId,
        recipientLabel: rec.recipientLabel,
        amount: transferredValue * rec.fraction,
        basis: flatValue * share * rec.fraction,
        resultingAccountId: null, resultingLiabilityId: null,
      });
      if (rec.successorFmId != null) {
        // percent is the successor's ABSOLUTE business-ownership share:
        // deceased's share of the business × this recipient's fraction.
        successors.push({ familyMemberId: rec.successorFmId, percent: share * rec.fraction });
      }
    }

    // Record an ownerUpdates entry when there is a deceased family member to
    // remove. basisUpdates is unconditional: the §1014 step-up on the
    // deceased's share is correct regardless.
    if (input.deceasedFmId != null) {
      ownerUpdates.push({
        accountId: business.id, removeFamilyMemberId: input.deceasedFmId, successors,
      });
    }

    // §1014 step-up on the deceased's flat-value share.
    basisUpdates.push({
      accountId: business.id, newBasis: oldBasis * (1 - share) + flatValue * share,
    });
  }

  // Warn on will bequests whose subject doesn't name a top-level business
  // account. (entityId is the legacy field name on the bequest schema; we
  // still compare it to a business account id.)
  const deceasedWill =
    input.will && input.will.grantor === input.deceased ? input.will : null;
  const businessIds = new Set(businesses.map((a) => a.id));
  for (const b of deceasedWill?.bequests ?? []) {
    if (b.entityId != null && !businessIds.has(b.entityId)) {
      warnings.push(`business_bequest_names_non_business: ${b.id}`);
    }
  }

  return { transfers, ownerUpdates, basisUpdates, warnings };
}
