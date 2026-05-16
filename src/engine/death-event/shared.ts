import type { ClientInfo, Account, Liability, DeathTransfer, EstateTaxResult, FamilyMember, Will, WillBequest, EntitySummary, Income, PlanSettings, Gift, GiftEvent, BeneficiaryRef } from "../types";
import { nextSyntheticId } from "../asset-transactions";
import type { FilingStatus } from "../../lib/tax/types";
import type { AccountOwner } from "../ownership";
import { controllingEntity, controllingFamilyMember, isFullyEntityOwned, ownedByHousehold } from "../ownership";

/** Compute the year of the first-death event. Returns null when there is no
 *  spouse, when no lifeExpectancy is set, or when the earliest death falls
 *  outside the plan horizon. When both spouses die in the same year, client
 *  is treated as dying first (deterministic convention — see spec 4b).
 */
export function computeFirstDeathYear(
  client: ClientInfo,
  planStartYear: number,
  planEndYear: number,
): number | null {
  if (!client.spouseDob) return null;
  if (client.lifeExpectancy == null) return null;

  const clientBirthYear = parseInt(client.dateOfBirth.slice(0, 4), 10);
  const spouseBirthYear = parseInt(client.spouseDob.slice(0, 4), 10);

  const clientDeathYear = clientBirthYear + client.lifeExpectancy;
  // Match the orchestrator's fallback: null spouseLifeExpectancy → 95
  const spouseLE = client.spouseLifeExpectancy ?? 95;
  const spouseDeathYear = spouseBirthYear + spouseLE;

  // Tiebreaker: client first when equal
  const firstDeathYear =
    clientDeathYear <= spouseDeathYear ? clientDeathYear : spouseDeathYear;

  if (firstDeathYear < planStartYear || firstDeathYear > planEndYear) {
    return null;
  }
  return firstDeathYear;
}

/** Given the first-death year, identify who died first. */
export function identifyDeceased(
  client: ClientInfo,
  firstDeathYear: number,
): "client" | "spouse" {
  const clientBirthYear = parseInt(client.dateOfBirth.slice(0, 4), 10);
  const clientDeathYear = clientBirthYear + (client.lifeExpectancy ?? 95);
  // Tiebreaker: client first
  return clientDeathYear <= firstDeathYear ? "client" : "spouse";
}

/** Compute the final-death year. For a couple, the later of the two assumed
 *  death years. For a single-filer client (no spouseDob), the client's own
 *  death year. Returns null when lifeExpectancy is missing or the computed
 *  year falls past the plan horizon.
 *
 *  Mirrors computeFirstDeathYear's spouseLifeExpectancy fallback of 95. */
export function computeFinalDeathYear(
  client: ClientInfo,
  planStartYear: number,
  planEndYear: number,
): number | null {
  if (client.lifeExpectancy == null) return null;

  const clientBirthYear = parseInt(client.dateOfBirth.slice(0, 4), 10);
  const clientDeathYear = clientBirthYear + client.lifeExpectancy;

  let finalDeathYear: number;
  if (client.spouseDob) {
    const spouseBirthYear = parseInt(client.spouseDob.slice(0, 4), 10);
    const spouseLE = client.spouseLifeExpectancy ?? 95;
    const spouseDeathYear = spouseBirthYear + spouseLE;
    finalDeathYear = Math.max(clientDeathYear, spouseDeathYear);
  } else {
    finalDeathYear = clientDeathYear;
  }

  if (finalDeathYear < planStartYear || finalDeathYear > planEndYear) {
    return null;
  }
  return finalDeathYear;
}

/** Given who died first (or null for single-filer), identify who the final
 *  deceased is. For a couple, it's whoever didn't die first. For a
 *  single-filer, always "client". */
export function identifyFinalDeceased(
  _client: ClientInfo,
  firstDeceased: "client" | "spouse" | null,
): "client" | "spouse" {
  if (firstDeceased === "client") return "spouse";
  if (firstDeceased === "spouse") return "client";
  return "client";
}

export type OwnerMutation = {
  /** Replacement ownership for the resulting account after a death-event split.
   *  Exactly one entry (100 %) for a single-owner transfer; two entries (50/50
   *  each) is not produced by any current death-event path (joint accounts are
   *  retitled to the survivor 100 %). */
  owners: AccountOwner[];
};

export type SplitShare = {
  /** 0 < fraction ≤ 1. Sum of all shares' fractions must equal 1. */
  fraction: number;
  /** When true, this share produces NO resulting account — the value leaves
   *  the household. Still emits a ledger entry. */
  removed?: boolean;
  /** When !removed, the ownership to assign to the resulting account. */
  ownerMutation?: OwnerMutation;
  /** Beneficiary designations to set on the resulting account. When omitted,
   *  the resulting account's designations are cleared — the new owner's own
   *  designations govern. Used for death-event carry-forward: the contingent
   *  tier carried onto a surviving spouse's account so it governs that
   *  spouse's later death. */
  carryForwardBeneficiaries?: BeneficiaryRef[];
  ledgerMeta: {
    via: DeathTransfer["via"];
    recipientKind: DeathTransfer["recipientKind"];
    recipientId: string | null;
    recipientLabel: string;
  };
};

export interface SplitAccountResult {
  resultingAccounts: Account[];
  resultingLiabilities: Liability[];
  ledgerEntries: Array<Omit<DeathTransfer, "year" | "deceased" | "deathOrder">>;
}

/** §1014 basis step-up at death. Returns the post-death basis for an
 *  asset that was owned (in whole or in part) by the decedent.
 *  Categories that are income-in-respect-of-a-decedent (`retirement`)
 *  or have no cost-basis concept (`life_insurance`) do not step up.
 *  Joint accounts at first death receive a half step-up — the
 *  decedent's half resets to FMV, the survivor's half retains its
 *  basis. Common-law JTWROS only; community-property double step-up
 *  is deferred. `fmv < originalBasis` (a depreciated asset) still
 *  returns FMV — §1014 allows step-*down* as well as step-up.
 */
export function computeSteppedUpBasis(
  category: Account["category"],
  fmv: number,
  originalBasis: number,
  opts: { isJointAtFirstDeath: boolean },
): number {
  if (category === "retirement" || category === "life_insurance") {
    return originalBasis;
  }
  if (opts.isJointAtFirstDeath) {
    return originalBasis * 0.5 + fmv * 0.5;
  }
  return fmv;
}

/** Split (or mutate-in-place) an account according to a list of shares.
 *  Shares' fractions must sum to 1. When there's exactly one share with
 *  fraction=1, the original account is mutated in-place and its id is
 *  preserved. Otherwise, the original is discarded and synthetic accounts
 *  (one per in-household share) replace it, with proportional value + basis.
 *  A linked liability (if provided) follows the same split; if all shares
 *  are `removed`, the liability is removed too. */
export function splitAccount(
  source: Account,
  shares: SplitShare[],
  linkedLiability: Liability | undefined,
): SplitAccountResult {
  for (const sh of shares) {
    if (sh.fraction <= 0) {
      throw new Error(
        `splitAccount: share fraction must be > 0 (got ${sh.fraction})`,
      );
    }
  }

  // Invariant: shares fractions sum to 1 (± 1e-9 for float safety)
  const total = shares.reduce((s, sh) => s + sh.fraction, 0);
  if (Math.abs(total - 1) > 1e-9) {
    throw new Error(
      `splitAccount: shares must sum to 1 for account ${source.id}, got ${total}`,
    );
  }

  const inPlace = shares.length === 1 && !shares[0].removed;
  const resultingAccounts: Account[] = [];
  const resultingLiabilities: Liability[] = [];
  const ledgerEntries: SplitAccountResult["ledgerEntries"] = [];

  for (const share of shares) {
    const amount = source.value * share.fraction;
    const basisShare = source.basis * share.fraction;

    const liabBalanceShare = linkedLiability
      ? linkedLiability.balance * share.fraction
      : 0;

    if (share.removed) {
      ledgerEntries.push({
        sourceAccountId: source.id,
        sourceAccountName: source.name,
        sourceLiabilityId: null,
        sourceLiabilityName: null,
        via: share.ledgerMeta.via,
        recipientKind: share.ledgerMeta.recipientKind,
        recipientId: share.ledgerMeta.recipientId,
        recipientLabel: share.ledgerMeta.recipientLabel,
        amount,
        basis: basisShare,
        resultingAccountId: null,
        resultingLiabilityId: null,
      });
      // Linked-liability encumbrance follows the asset to the external
      // recipient as a parallel negative-amount entry. The liability row
      // itself is dropped (debts follow assets out of the household), but
      // the report needs to show the encumbrance reducing the recipient's
      // net.
      if (linkedLiability && liabBalanceShare > 0) {
        ledgerEntries.push({
          sourceAccountId: null,
          sourceAccountName: null,
          sourceLiabilityId: linkedLiability.id,
          sourceLiabilityName: linkedLiability.name,
          via: share.ledgerMeta.via,
          recipientKind: share.ledgerMeta.recipientKind,
          recipientId: share.ledgerMeta.recipientId,
          recipientLabel: share.ledgerMeta.recipientLabel,
          amount: -liabBalanceShare,
          basis: 0,
          resultingAccountId: null,
          resultingLiabilityId: null,
        });
      }
      continue;
    }

    // The resulting account's beneficiary designations are normally cleared —
    // the new owner's own designations govern. Exception: a death-event step
    // may carry designations forward via `share.carryForwardBeneficiaries`
    // (the contingent tier promoted onto a surviving spouse's account so it
    // governs that spouse's later death). Undefined when not requested →
    // identical to the prior always-clear behavior.
    const carriedBeneficiaries = share.carryForwardBeneficiaries;
    let newAccount: Account;
    if (inPlace) {
      // Mutate original: keep id, name, value, basis unchanged.
      newAccount = {
        ...source,
        beneficiaries: carriedBeneficiaries,
      };
    } else {
      newAccount = {
        ...source,
        id: nextSyntheticId("death-acct"),
        name: `${source.name} — to ${share.ledgerMeta.recipientLabel}`,
        value: amount,
        basis: basisShare,
        beneficiaries: carriedBeneficiaries,
      };
    }

    // Apply owner mutation: replace owners[] with the post-transfer ownership.
    if (share.ownerMutation) {
      newAccount.owners = share.ownerMutation.owners;
    }

    resultingAccounts.push(newAccount);

    // Liability follow-through: one liability per kept share, proportional.
    // The liability adopts the asset's post-transfer owners so downstream
    // computations (computeGrossEstate at the next death, balance-sheet
    // ownership, etc.) treat it as the new owner's debt. Without this,
    // the linked debt stays attributed to the original (now-deceased)
    // grantor and gets skipped at the survivor's death as "non-principal
    // heir owned" — leaving the gross estate inflated by the debt amount.
    let resultingLiabilityId: string | null = null;
    if (linkedLiability) {
      if (inPlace) {
        resultingLiabilities.push({
          ...linkedLiability,
          owners: newAccount.owners,
          // id and linkedPropertyId unchanged (account kept its id)
        });
        resultingLiabilityId = linkedLiability.id;
      } else {
        const newLiabId = nextSyntheticId("death-liab");
        resultingLiabilities.push({
          ...linkedLiability,
          id: newLiabId,
          balance: liabBalanceShare,
          monthlyPayment: linkedLiability.monthlyPayment * share.fraction,
          linkedPropertyId: newAccount.id,
          owners: newAccount.owners,
        });
        resultingLiabilityId = newLiabId;
      }
    }

    ledgerEntries.push({
      sourceAccountId: source.id,
      sourceAccountName: source.name,
      sourceLiabilityId: null,
      sourceLiabilityName: null,
      via: share.ledgerMeta.via,
      recipientKind: share.ledgerMeta.recipientKind,
      recipientId: share.ledgerMeta.recipientId,
      recipientLabel: share.ledgerMeta.recipientLabel,
      amount,
      basis: basisShare,
      resultingAccountId: newAccount.id,
      resultingLiabilityId: null,
    });

    // Linked-liability transfer: the encumbrance follows the asset to its
    // new owner as a parallel negative-amount entry. Mirrors the
    // unlinked_liability_proportional and will_liability_bequest patterns
    // so the transfer report can show the recipient's net (asset − debt).
    if (linkedLiability && liabBalanceShare > 0) {
      ledgerEntries.push({
        sourceAccountId: null,
        sourceAccountName: null,
        sourceLiabilityId: linkedLiability.id,
        sourceLiabilityName: linkedLiability.name,
        via: share.ledgerMeta.via,
        recipientKind: share.ledgerMeta.recipientKind,
        recipientId: share.ledgerMeta.recipientId,
        recipientLabel: share.ledgerMeta.recipientLabel,
        amount: -liabBalanceShare,
        basis: 0,
        resultingAccountId: null,
        resultingLiabilityId,
      });
    }
  }

  return { resultingAccounts, resultingLiabilities, ledgerEntries };
}

/** Result of a precedence step for a single source account. When `consumed`
 *  is true, the caller should NOT cascade this account to later steps —
 *  step 1 (titling) and full-coverage later steps mark consumed=true. */
export interface StepResult {
  consumed: boolean;
  resultingAccounts: Account[];
  resultingLiabilities: Liability[];
  ledgerEntries: Array<Omit<DeathTransfer, "year" | "deceased" | "deathOrder">>;
  /** Fraction of the source account that has been claimed by this step (0–1).
   *  Used when step 2 partially claims and step 3 picks up the remainder. */
  fractionClaimed: number;
}

export interface ExternalBeneficiarySummary {
  id: string;
  name: string;
  kind?: "charity" | "individual";
}

/** Returns true when the account is joint-household-owned (two FM owners each
 *  at ≈ 50%). Entity-owned and single-owner household accounts return false. */
function isJointHousehold(a: Account): boolean {
  const fmRows = a.owners.filter((o) => o.kind === "family_member");
  if (fmRows.length !== 2) return false;
  if (a.owners.some((o) => o.kind === "entity")) return false;
  const total = ownedByHousehold(a);
  const EPSILON = 0.0001;
  return Math.abs(total - 1) < EPSILON;
}

/** Step 1: Titling. Joint accounts pass 100% to the survivor via right-of-
 *  survivorship. Non-joint accounts pass through unchanged.
 *  @param survivorFmId  Family-member id of the surviving spouse. */
export function applyTitling(
  source: Account,
  _survivor: "client" | "spouse",
  linkedLiability: Liability | undefined,
  survivorFmId: string,
): StepResult {
  if (!isJointHousehold(source)) {
    return {
      consumed: false,
      resultingAccounts: [],
      resultingLiabilities: [],
      ledgerEntries: [],
      fractionClaimed: 0,
    };
  }

  const split = splitAccount(
    source,
    [
      {
        fraction: 1,
        ownerMutation: {
          owners: [{ kind: "family_member", familyMemberId: survivorFmId, percent: 1 }],
        },
        ledgerMeta: {
          via: "titling",
          recipientKind: "spouse",
          // Carries survivor's FM id so the resolver finds the right person
          // (otherwise spouseFirst ordering mislabels the surviving client).
          recipientId: survivorFmId,
          recipientLabel: "Spouse",
        },
      },
    ],
    linkedLiability,
  );

  return {
    consumed: true,
    resultingAccounts: split.resultingAccounts,
    resultingLiabilities: split.resultingLiabilities,
    ledgerEntries: split.ledgerEntries,
    fractionClaimed: 1,
  };
}

/** Step 2: account beneficiary designations.
 *
 *  The PRIMARY tier routes the undisposed fraction to its beneficiaries. A
 *  primary that names a household principal known to be dead — the decedent
 *  (`deceasedFmId`), or the principal who predeceased a final-death event
 *  (`predeceasedFmId`) — "lapses": its fraction is reassigned to the
 *  CONTINGENT tier, split by the contingent beneficiaries' percentages. A
 *  contingent that itself names a dead principal lapses too; its sub-fraction
 *  stays undisposed and cascades to the will / fallback steps (no recursion).
 *
 *  Carry-forward: when a LIVE primary routes the asset to the surviving spouse
 *  (`survivorFmId`, supplied at first death only), the contingent tier is
 *  carried forward — promoted to the primary tier — onto the resulting
 *  spouse-owned account, so it governs the asset at the spouse's later death.
 *
 *  Returns fractionClaimed ≤ undisposedFraction; consumed when the live tiers
 *  fully cover the undisposed remainder. */
export function applyBeneficiaryDesignations(
  source: Account,
  undisposedFraction: number,
  familyMembers: FamilyMember[],
  externals: ExternalBeneficiarySummary[],
  entities: EntitySummary[],
  linkedLiability: Liability | undefined,
  /** FM id of the decedent. Designations naming this person lapse — you can't
   *  inherit your own asset. Defaults to null (no lapse check). */
  deceasedFmId: string | null = null,
  /** FM id of the surviving spouse — supplied at first death only. When a live
   *  primary routes the asset to this person, the contingent tier is carried
   *  forward onto the resulting account. Null at final death. */
  survivorFmId: string | null = null,
  /** FM id of a household principal who predeceased this death event — i.e.
   *  the first-death decedent, supplied at final death. Designations naming
   *  this person also lapse. Null at first death. */
  predeceasedFmId: string | null = null,
): StepResult {
  const noDesignations: StepResult = {
    consumed: false,
    resultingAccounts: [],
    resultingLiabilities: [],
    ledgerEntries: [],
    fractionClaimed: 0,
  };

  const allBeneficiaries = source.beneficiaries ?? [];
  const primaryTier = allBeneficiaries.filter((b) => b.tier === "primary");
  const contingentTier = allBeneficiaries.filter((b) => b.tier === "contingent");
  if (primaryTier.length === 0) {
    return noDesignations;
  }

  // A designation lapses when it names a household principal known to be dead:
  // the decedent, or (at final death) the principal who predeceased this event.
  const deadPrincipalIds = new Set(
    [deceasedFmId, predeceasedFmId].filter((id): id is string => id != null),
  );
  const namesDeadPrincipal = (b: BeneficiaryRef): boolean => {
    if (deadPrincipalIds.size === 0) return false;
    if (b.familyMemberId) return deadPrincipalIds.has(b.familyMemberId);
    if (b.householdRole) {
      const roleFm = familyMembers.find((f) => f.role === b.householdRole);
      return roleFm != null && deadPrincipalIds.has(roleFm.id);
    }
    return false;
  };

  // Carry-forward payload: the contingent tier promoted to the primary tier.
  // Populated only at first death (survivorFmId != null) and only when a
  // contingent tier exists; attached per-share to surviving-spouse recipients.
  const carryForward: BeneficiaryRef[] | undefined =
    survivorFmId != null && contingentTier.length > 0
      ? contingentTier.map((b) => ({ ...b, tier: "primary" as const }))
      : undefined;

  // Fraction of the primary tier (as a percentage, 0–100) that lapses because
  // its beneficiary is a dead principal — this reassigns to the contingent tier.
  const lapsedPrimaryPct = primaryTier
    .filter((b) => namesDeadPrincipal(b))
    .reduce((s, b) => s + b.percentage, 0);

  // Recipients of this account: live primaries at their own percentage, plus
  // contingent beneficiaries scaled by the lapsed primary fraction. `fromPrimary`
  // tracks which tier a recipient came from — only live primaries carry forward.
  type TaggedRecipient = { ref: BeneficiaryRef; weight: number; fromPrimary: boolean };
  const recipients: TaggedRecipient[] = [];
  for (const b of primaryTier) {
    if (namesDeadPrincipal(b)) continue;
    recipients.push({ ref: b, weight: b.percentage / 100, fromPrimary: true });
  }
  if (lapsedPrimaryPct > 0) {
    for (const b of contingentTier) {
      if (namesDeadPrincipal(b)) continue; // contingent lapse → cascades to will/fallback
      recipients.push({
        ref: b,
        weight: (lapsedPrimaryPct / 100) * (b.percentage / 100),
        fromPrimary: false,
      });
    }
  }
  if (recipients.length === 0) {
    return noDesignations;
  }

  const famMap = new Map(familyMembers.map((f) => [f.id, f]));
  const extMap = new Map(externals.map((e) => [e.id, e]));

  const shares: SplitShare[] = recipients.map(({ ref: b, weight, fromPrimary }) => {
    const fraction = undisposedFraction * weight;
    let ownerMutation: OwnerMutation | undefined;
    let recipientKind: DeathTransfer["recipientKind"];
    let recipientId: string | null;
    let recipientLabel: string;
    let removed = false;

    if (b.familyMemberId) {
      ownerMutation = { owners: [{ kind: "family_member", familyMemberId: b.familyMemberId, percent: 1 }] };
      recipientKind = "family_member";
      recipientId = b.familyMemberId;
      const fam = famMap.get(b.familyMemberId);
      recipientLabel = fam
        ? `${fam.firstName}${fam.lastName ? " " + fam.lastName : ""}`
        : "Family member";
    } else if (b.externalBeneficiaryId) {
      removed = true;
      recipientKind = "external_beneficiary";
      recipientId = b.externalBeneficiaryId;
      const ext = extMap.get(b.externalBeneficiaryId);
      recipientLabel = ext?.name ?? "External beneficiary";
    } else if (b.householdRole) {
      const roleFm = familyMembers.find((f) => f.role === b.householdRole);
      if (roleFm) {
        ownerMutation = { owners: [{ kind: "family_member", familyMemberId: roleFm.id, percent: 1 }] };
      } else {
        removed = true;
      }
      recipientKind = b.householdRole === "spouse" ? "spouse" : "family_member";
      recipientId = roleFm?.id ?? null;
      recipientLabel = b.householdRole === "spouse" ? "Spouse" : "Client";
    } else if (b.entityIdRef) {
      ownerMutation = { owners: [{ kind: "entity", entityId: b.entityIdRef, percent: 1 }] };
      recipientKind = "entity";
      recipientId = b.entityIdRef;
      const ent = entities.find((e) => e.id === b.entityIdRef);
      recipientLabel = ent?.name ?? "Trust";
    } else {
      // Defensive — shouldn't happen if API validation is intact.
      removed = true;
      recipientKind = "external_beneficiary";
      recipientId = null;
      recipientLabel = "Unknown beneficiary";
    }

    // Carry-forward: a live primary inherited by the surviving spouse carries
    // the contingent tier forward so it governs the spouse's later death.
    const carryForwardBeneficiaries =
      fromPrimary && !removed && recipientId != null && recipientId === survivorFmId
        ? carryForward
        : undefined;

    return {
      fraction,
      removed: removed || undefined,
      ownerMutation,
      carryForwardBeneficiaries,
      ledgerMeta: {
        via: "beneficiary_designation",
        recipientKind,
        recipientId,
        recipientLabel,
      },
    };
  });

  const totalClaimed = shares.reduce((s, sh) => s + sh.fraction, 0);
  if (totalClaimed < 1e-9) {
    return noDesignations;
  }

  // Scale source to the totalClaimed portion so splitAccount (which requires
  // shares summing to 1) works correctly. Normalize shares to sum to 1.
  const scaledSource: Account = {
    ...source,
    value: source.value * totalClaimed,
    basis: source.basis * totalClaimed,
  };
  const scaledLiability: Liability | undefined = linkedLiability
    ? {
        ...linkedLiability,
        balance: linkedLiability.balance * totalClaimed,
        monthlyPayment: linkedLiability.monthlyPayment * totalClaimed,
      }
    : undefined;

  const normalized = shares.map((sh) => ({
    ...sh,
    fraction: sh.fraction / totalClaimed,
  }));

  const split = splitAccount(scaledSource, normalized, scaledLiability);

  return {
    consumed: Math.abs(totalClaimed - undisposedFraction) < 1e-9,
    resultingAccounts: split.resultingAccounts,
    resultingLiabilities: split.resultingLiabilities,
    ledgerEntries: split.ledgerEntries,
    fractionClaimed: totalClaimed,
  };
}

/** Predicate: which condition-tier bequests fire at a given death order.
 *  At first death (order 1): `always` and `if_spouse_survives` fire.
 *  At final death (order 2): `always` and `if_spouse_predeceased` fire.
 *  For a single-filer client, the advisor UI shouldn't present spouse-
 *  conditional options, but if either appears in the data, the order-2
 *  interpretation (no living spouse is the single-filer state) applies. */
export function firesAtDeath(b: WillBequest, deathOrder: 1 | 2): boolean {
  if (b.condition === "always") return true;
  if (b.condition === "if_spouse_survives") return deathOrder === 1;
  if (b.condition === "if_spouse_predeceased") return deathOrder === 2;
  return false;
}

function resolveRecipientLabelAndMutation(
  r: WillBequest["recipients"][number],
  _survivor: "client" | "spouse" | null,
  survivorFmId: string | null,
  familyMembers: FamilyMember[],
  externals: ExternalBeneficiarySummary[],
  entities: EntitySummary[],
): {
  ownerMutation?: OwnerMutation;
  removed: boolean;
  recipientKind: DeathTransfer["recipientKind"];
  recipientId: string | null;
  recipientLabel: string;
} {
  if (r.recipientKind === "spouse") {
    return {
      ownerMutation: survivorFmId != null
        ? { owners: [{ kind: "family_member", familyMemberId: survivorFmId, percent: 1 }] }
        : undefined,
      removed: false,
      recipientKind: "spouse",
      recipientId: survivorFmId,
      recipientLabel: "Spouse",
    };
  }
  if (r.recipientKind === "family_member") {
    const fam = familyMembers.find((f) => f.id === r.recipientId);
    return {
      ownerMutation: { owners: [{ kind: "family_member", familyMemberId: r.recipientId!, percent: 1 }] },
      removed: false,
      recipientKind: "family_member",
      recipientId: r.recipientId,
      recipientLabel: fam
        ? `${fam.firstName}${fam.lastName ? " " + fam.lastName : ""}`
        : "Family member",
    };
  }
  if (r.recipientKind === "entity") {
    const ent = entities.find((e) => e.id === r.recipientId);
    return {
      ownerMutation: { owners: [{ kind: "entity", entityId: r.recipientId!, percent: 1 }] },
      removed: false,
      recipientKind: "entity",
      recipientId: r.recipientId,
      recipientLabel: ent ? `Entity ${r.recipientId}` : "Entity",
    };
  }
  // external_beneficiary
  const ext = externals.find((e) => e.id === r.recipientId);
  return {
    removed: true,
    recipientKind: "external_beneficiary",
    recipientId: r.recipientId,
    recipientLabel: ext?.name ?? "External beneficiary",
  };
}

/** Step 3a: specific-asset bequests for this account. Over-allocation
 *  (specifics summing >100% of the undisposed remainder) is pro-rated and a
 *  warning is emitted. Returns fractionClaimed + warnings. */
export function applyWillSpecificBequests(
  source: Account,
  undisposedFraction: number,
  will: Will,
  deathOrder: 1 | 2,
  survivor: "client" | "spouse" | null,
  survivorFmId: string | null,
  familyMembers: FamilyMember[],
  externals: ExternalBeneficiarySummary[],
  entities: EntitySummary[],
  linkedLiability: Liability | undefined,
): StepResult & { warnings: string[] } {
  const specifics = will.bequests.filter(
    (b) =>
      b.kind === "asset" &&
      b.assetMode === "specific" &&
      b.accountId === source.id &&
      firesAtDeath(b, deathOrder),
  );

  // Shared "this clause claims nothing" result — the account flows on to the
  // residuary / fallback steps untouched.
  const notFired = (
    warnings: string[],
  ): StepResult & { warnings: string[] } => ({
    consumed: false,
    resultingAccounts: [],
    resultingLiabilities: [],
    ledgerEntries: [],
    fractionClaimed: 0,
    warnings,
  });

  if (specifics.length === 0) {
    return notFired([]);
  }

  // Compute per-bequest fractions (of the source account total). Over-
  // allocation (sum > 1) pro-rates.
  const bequestFractions = specifics.map(
    (b) => undisposedFraction * (b.percentage / 100),
  );
  const rawTotal = bequestFractions.reduce((s, f) => s + f, 0);
  const warnings: string[] = [];
  let scale = 1;
  if (rawTotal > undisposedFraction + 1e-9) {
    warnings.push(`over_allocation_in_will:${source.id}`);
    scale = undisposedFraction / rawTotal;
  }
  const scaledBequestFractions = bequestFractions.map((f) => f * scale);

  // Flatten into per-recipient shares
  const shares: SplitShare[] = [];
  specifics.forEach((b, i) => {
    const bFrac = scaledBequestFractions[i];
    b.recipients.forEach((r) => {
      const rFrac = bFrac * (r.percentage / 100);
      const { ownerMutation, removed, recipientKind, recipientId, recipientLabel } =
        resolveRecipientLabelAndMutation(r, survivor, survivorFmId, familyMembers, externals, entities);
      shares.push({
        fraction: rFrac,
        removed: removed || undefined,
        ownerMutation,
        ledgerMeta: { via: "will", recipientKind, recipientId, recipientLabel },
      });
    });
  });

  const totalClaimed = shares.reduce((s, sh) => s + sh.fraction, 0);

  // A specific clause with no effective allocation — every matching bequest
  // resolved to zero recipients (e.g. the distribution dialog cleared them) or
  // zero percentages — claims nothing. Treat it as not-fired, rather than
  // dividing by zero when normalizing shares below.
  if (totalClaimed < 1e-9) {
    return notFired(warnings);
  }

  // Scale source + liability down to `totalClaimed` and normalize shares to sum=1.
  const scaledSource: Account = {
    ...source,
    value: source.value * totalClaimed,
    basis: source.basis * totalClaimed,
  };
  const scaledLiability: Liability | undefined = linkedLiability
    ? {
        ...linkedLiability,
        balance: linkedLiability.balance * totalClaimed,
        monthlyPayment: linkedLiability.monthlyPayment * totalClaimed,
      }
    : undefined;
  const normalized = shares.map((sh) => ({ ...sh, fraction: sh.fraction / totalClaimed }));

  const split = splitAccount(scaledSource, normalized, scaledLiability);

  return {
    consumed: Math.abs(totalClaimed - undisposedFraction) < 1e-9,
    resultingAccounts: split.resultingAccounts,
    resultingLiabilities: split.resultingLiabilities,
    ledgerEntries: split.ledgerEntries,
    fractionClaimed: totalClaimed,
    warnings,
  };
}

/** Step 3b: "all other assets" residual. Fires ONLY when no specific clause
 *  in this will touched this account. Sweeps the full undisposed remainder
 *  across the all_assets clauses' recipients. Multiple all_assets clauses
 *  (rare) split the residual among themselves per their own percentages. */
export function applyWillAllAssetsResidual(
  source: Account,
  undisposedFraction: number,
  accountTouchedBySpecific: boolean,
  will: Will,
  deathOrder: 1 | 2,
  survivor: "client" | "spouse" | null,
  survivorFmId: string | null,
  familyMembers: FamilyMember[],
  externals: ExternalBeneficiarySummary[],
  entities: EntitySummary[],
  linkedLiability: Liability | undefined,
): StepResult {
  if (accountTouchedBySpecific) {
    return empty();
  }
  const allAssets = will.bequests.filter(
    (b) => b.kind === "asset" && b.assetMode === "all_assets" && firesAtDeath(b, deathOrder),
  );
  if (allAssets.length === 0) {
    return empty();
  }

  // Distribute undisposedFraction across all_assets clauses by their percentage.
  const weights = allAssets.map((b) => b.percentage);
  const weightSum = weights.reduce((s, w) => s + w, 0);

  const shares: SplitShare[] = [];
  allAssets.forEach((b, i) => {
    const clauseFraction = undisposedFraction * (weights[i] / weightSum);
    b.recipients.forEach((r) => {
      const rFrac = clauseFraction * (r.percentage / 100);
      const { ownerMutation, removed, recipientKind, recipientId, recipientLabel } =
        resolveRecipientLabelAndMutation(r, survivor, survivorFmId, familyMembers, externals, entities);
      shares.push({
        fraction: rFrac,
        removed: removed || undefined,
        ownerMutation,
        ledgerMeta: { via: "will", recipientKind, recipientId, recipientLabel },
      });
    });
  });

  const totalClaimed = shares.reduce((s, sh) => s + sh.fraction, 0);
  const scaledSource: Account = {
    ...source,
    value: source.value * totalClaimed,
    basis: source.basis * totalClaimed,
  };
  const scaledLiability: Liability | undefined = linkedLiability
    ? {
        ...linkedLiability,
        balance: linkedLiability.balance * totalClaimed,
        monthlyPayment: linkedLiability.monthlyPayment * totalClaimed,
      }
    : undefined;
  const normalized = shares.map((sh) => ({ ...sh, fraction: sh.fraction / totalClaimed }));
  const split = splitAccount(scaledSource, normalized, scaledLiability);

  return {
    consumed: true,
    resultingAccounts: split.resultingAccounts,
    resultingLiabilities: split.resultingLiabilities,
    ledgerEntries: split.ledgerEntries,
    fractionClaimed: totalClaimed,
  };
}

function empty(): StepResult {
  return {
    consumed: false,
    resultingAccounts: [],
    resultingLiabilities: [],
    ledgerEntries: [],
    fractionClaimed: 0,
  };
}

/** Per-year filing status. After the first-death year, the survivor files as
 *  single. Year of death itself keeps the configured MFJ status (matches IRS). */
export function effectiveFilingStatus(
  configured: FilingStatus,
  firstDeathYear: number | null,
  year: number,
): FilingStatus {
  if (firstDeathYear != null && year > firstDeathYear) return "single";
  return configured;
}

/** Clip deceased-owner personal incomes at the death year, and retitle joint
 *  personal incomes to the survivor. Entity-owned incomes pass through. */
export function applyIncomeTermination(
  incomes: Income[],
  deceased: "client" | "spouse",
  survivor: "client" | "spouse",
  deathYear: number,
): Income[] {
  return incomes.map((inc) => {
    if (inc.ownerEntityId) return inc;
    if (inc.owner === deceased) {
      // Death year runs to completion; year+1 onward is suppressed.
      return { ...inc, endYear: Math.min(inc.endYear, deathYear) };
    }
    if (inc.owner === "joint") {
      return { ...inc, owner: survivor };
    }
    return inc;
  });
}

export interface UnlinkedLiabilityDistributionResult {
  updatedLiabilities: Liability[];
  liabilityTransfers: DeathTransfer[];
  warnings: string[];
}

/** Default-order recipients for unlinked debt — mirrors the asset-side chain
 *  in `applyFallback`. Returns shares summing to 1.
 *    tier 1: surviving spouse (when present)
 *    tier 2: equal split across living non-principal children
 *    tier 3: "Other Heirs" system_default sink
 */
function defaultOrderDebtRecipients(
  survivorFmId: string | null,
  familyMembers: FamilyMember[],
): Array<{
  kind: DeathTransfer["recipientKind"];
  id: string | null;
  label: string;
  share: number;
}> {
  if (survivorFmId != null) {
    return [{ kind: "spouse", id: survivorFmId, label: "Spouse", share: 1 }];
  }
  const children = familyMembers.filter(
    (f) => f.relationship === "child" && f.role !== "client" && f.role !== "spouse",
  );
  if (children.length > 0) {
    const perChild = 1 / children.length;
    return children.map((c) => ({
      kind: "family_member" as const,
      id: c.id,
      label: `${c.firstName}${c.lastName ? " " + c.lastName : ""}`,
      share: perChild,
    }));
  }
  return [{ kind: "system_default", id: null, label: "Other Heirs", share: 1 }];
}

/** Default-order distribution of unlinked household liabilities at final death.
 *  Runs after the asset precedence chain when the creditor-payoff drain leaves
 *  residual debt. Each unlinked liability flows to default-order heirs (spouse
 *  → children → other heirs) — NOT pro-rata to asset recipients. Will-liability
 *  bequests have already been peeled off upstream by `applyLiabilityBequests`.
 *
 *  Family-member recipients keep the debt as a new liability row tagged with
 *  `ownerFamilyMemberId`; system_default recipients drop the row (debt leaves
 *  the household model). */
export function distributeUnlinkedLiabilities(
  liabilities: Liability[],
  year: number,
  deceased: "client" | "spouse",
  familyMembers: FamilyMember[],
): UnlinkedLiabilityDistributionResult {
  const unlinked = liabilities.filter(
    (l) => l.linkedPropertyId == null && !isFullyEntityOwned(l),
  );

  if (unlinked.length === 0) {
    return { updatedLiabilities: liabilities, liabilityTransfers: [], warnings: [] };
  }

  // Final death: no surviving spouse possible. Pass null so the chain skips
  // tier 1 and routes to children → other heirs.
  const recipients = defaultOrderDebtRecipients(null, familyMembers);

  const warnings: string[] = [];
  const liabilityTransfers: DeathTransfer[] = [];
  const newLiabilityRows: Liability[] = [];
  const removedLiabilityIds = new Set<string>();

  for (const liab of unlinked) {
    for (const rec of recipients) {
      const shareBalance = liab.balance * rec.share;
      const sharePayment = liab.monthlyPayment * rec.share;

      let resultingLiabilityId: string | null = null;
      if (rec.kind === "family_member" && rec.id != null) {
        const newId = nextSyntheticId("death-liab");
        newLiabilityRows.push({
          id: newId,
          name: `${liab.name} — ${rec.label} share`,
          balance: shareBalance,
          interestRate: liab.interestRate,
          monthlyPayment: sharePayment,
          startYear: liab.startYear,
          startMonth: liab.startMonth,
          termMonths: liab.termMonths,
          extraPayments: [],
          ownerFamilyMemberId: rec.id,  // signals "distributed-to-heir" semantics
          isInterestDeductible: liab.isInterestDeductible,
          owners: [{ kind: "family_member", familyMemberId: rec.id, percent: 1 }],
        });
        resultingLiabilityId = newId;
      }

      liabilityTransfers.push({
        year,
        deathOrder: 2,
        deceased,
        sourceAccountId: null,
        sourceAccountName: null,
        sourceLiabilityId: liab.id,
        sourceLiabilityName: liab.name,
        via: "unlinked_liability_proportional",
        recipientKind: rec.kind,
        recipientId: rec.id,
        recipientLabel: rec.label,
        amount: -shareBalance,
        basis: 0,
        resultingAccountId: null,
        resultingLiabilityId,
      });
    }

    removedLiabilityIds.add(liab.id);
  }

  const updatedLiabilities = [
    ...liabilities.filter((l) => !removedLiabilityIds.has(l.id)),
    ...newLiabilityRows,
  ];

  return { updatedLiabilities, liabilityTransfers, warnings };
}

/** First-death analog of distributeUnlinkedLiabilities. The asset precedence
 *  chain only routes assets — unlinked household debts (credit cards, personal
 *  loans, etc.) are left untouched and orphaned on the deceased. This step
 *  distributes the deceased's portion of each unlinked household debt to the
 *  asset recipients (proportional to their share of the deceased's gross asset
 *  estate), mirroring the unlinked_liability_proportional mechanism used at
 *  final death.
 *
 *  Without this, the gross estate (which includes deceased-owned debts as
 *  negative lines) won't reconcile against the transfer ledger, and the
 *  liability rows themselves stay owned by the now-deceased FM — so they'd
 *  also be excluded from the final-death gross estate by the
 *  controllingFamilyMember check.
 *
 *  Survivor's portion of joint debts stays in the household as a single row
 *  retitled to the survivor (owners → [survivor 1.0]). */
export function distributeFirstDeathUnlinkedLiabilities(
  liabilities: Liability[],
  deceasedFmId: string | null,
  survivorFmId: string | null,
  year: number,
  deceased: "client" | "spouse",
  familyMembers: FamilyMember[],
): UnlinkedLiabilityDistributionResult {
  const candidates = liabilities.filter(
    (l) =>
      l.linkedPropertyId == null &&
      !isFullyEntityOwned(l) &&
      !l.ownerFamilyMemberId,
  );
  if (candidates.length === 0) {
    return { updatedLiabilities: liabilities, liabilityTransfers: [], warnings: [] };
  }

  // Compute deceased's fraction per liability (mirrors computeGrossEstate
  // liability logic post-fix #1).
  type Bucket = { liab: Liability; deceasedFraction: number };
  const buckets: Bucket[] = [];
  for (const l of candidates) {
    const cfm = controllingFamilyMember(l);
    let deceasedFraction = 0;
    if (cfm != null) {
      if (cfm === deceasedFmId) deceasedFraction = 1;
      else continue; // owned by survivor or non-principal heir
    } else {
      if (ownedByHousehold(l) < 0.0001) continue; // entity-dominated
      deceasedFraction = 0.5; // joint household debt at first death
    }
    if (deceasedFraction > 0) buckets.push({ liab: l, deceasedFraction });
  }
  if (buckets.length === 0) {
    return { updatedLiabilities: liabilities, liabilityTransfers: [], warnings: [] };
  }

  // Default-order chain: spouse → children → other heirs. Independent of how
  // assets routed — the will still wins via `applyLiabilityBequests` upstream.
  const recipients = defaultOrderDebtRecipients(survivorFmId, familyMembers);

  const warnings: string[] = [];
  const removedIds = new Set<string>();
  const updatedById = new Map<string, Liability>();
  for (const l of liabilities) updatedById.set(l.id, l);
  const newLiabilityRows: Liability[] = [];
  const liabilityTransfers: DeathTransfer[] = [];

  for (const { liab, deceasedFraction } of buckets) {
    const deceasedBalance = liab.balance * deceasedFraction;
    const deceasedPayment = liab.monthlyPayment * deceasedFraction;
    const survivorBalance = liab.balance - deceasedBalance;
    const survivorPayment = liab.monthlyPayment - deceasedPayment;

    if (deceasedBalance <= 0) continue;

    for (const rec of recipients) {
      const shareBalance = deceasedBalance * rec.share;
      const sharePayment = deceasedPayment * rec.share;

      let resultingLiabilityId: string | null = null;
      const recFmId =
        rec.kind === "spouse" ? survivorFmId :
        rec.kind === "family_member" ? rec.id :
        null;
      if (recFmId != null) {
        // The ownerFamilyMemberId flag means "distributed to a non-household
        // heir; skip in subsequent household processing." Set it only when the
        // recipient is NOT the surviving spouse — the spouse is still a
        // household principal, and at final death this debt should flow back
        // through the unlinked-debt drain + distribution.
        const isSurvivorRecipient = recFmId === survivorFmId;
        const newId = nextSyntheticId("death-liab");
        newLiabilityRows.push({
          id: newId,
          name: `${liab.name} — ${rec.label} share`,
          balance: shareBalance,
          interestRate: liab.interestRate,
          monthlyPayment: sharePayment,
          startYear: liab.startYear,
          startMonth: liab.startMonth,
          termMonths: liab.termMonths,
          extraPayments: [],
          ...(isSurvivorRecipient ? {} : { ownerFamilyMemberId: recFmId }),
          isInterestDeductible: liab.isInterestDeductible,
          owners: [{ kind: "family_member", familyMemberId: recFmId, percent: 1 }],
        });
        resultingLiabilityId = newId;
      }
      // system_default recipients: debt leaves the household model entirely;
      // no new liability row is kept.

      liabilityTransfers.push({
        year,
        deathOrder: 1,
        deceased,
        sourceAccountId: null,
        sourceAccountName: null,
        sourceLiabilityId: liab.id,
        sourceLiabilityName: liab.name,
        via: "unlinked_liability_proportional",
        recipientKind: rec.kind,
        recipientId: rec.id,
        recipientLabel: rec.label,
        amount: -shareBalance,
        basis: 0,
        resultingAccountId: null,
        resultingLiabilityId,
      });
    }

    // Survivor's pre-existing portion (joint debts) stays in the household.
    // Retitle to the survivor as a single row; if survivorBalance is zero
    // (deceased was sole owner) or no survivor exists, drop the original.
    if (survivorBalance > 1e-9 && survivorFmId != null) {
      updatedById.set(liab.id, {
        ...liab,
        balance: survivorBalance,
        monthlyPayment: survivorPayment,
        owners: [{ kind: "family_member", familyMemberId: survivorFmId, percent: 1 }],
      });
    } else {
      removedIds.add(liab.id);
    }
  }

  const updatedLiabilities = [
    ...liabilities
      .filter((l) => !removedIds.has(l.id))
      .map((l) => updatedById.get(l.id) ?? l),
    ...newLiabilityRows,
  ];

  return { updatedLiabilities, liabilityTransfers, warnings };
}

export interface DeathEventInput {
  year: number;
  deceased: "client" | "spouse";
  survivor: "client" | "spouse";
  will: Will | null;
  accounts: Account[];
  accountBalances: Record<string, number>;
  basisMap: Record<string, number>;
  incomes: Income[];
  liabilities: Liability[];
  familyMembers: FamilyMember[];
  externalBeneficiaries: ExternalBeneficiarySummary[];
  entities: EntitySummary[];
  /** 4d-1 additions — estate-tax pipeline inputs. */
  planSettings: PlanSettings;
  gifts: Gift[];
  annualExclusionsByYear: Record<number, number>;
  /** Phase 3 gift events (asset + liability transfers). Used by
   *  computeAdjustedTaxableGifts to include asset-transfer values in lifetime
   *  exemption consumption. Optional for backwards compat with test fixtures
   *  that don't set it; defaults to [] in the consumer. */
  giftEvents?: GiftEvent[];
  /** Per-year end-of-year account balance snapshots, keyed by year then account id.
   *  Used by accountValueAtYear to return the balance at the gift year rather than
   *  the death year. Optional for backwards compat with test fixtures. */
  yearEndAccountBalances?: Map<number, Record<string, number>>;
  /** Stashed DSUE from a prior first-death event. 0 at first death;
   *  survivor's DSUE balance at final death. */
  dsueReceived: number;
  /** Pre-plan post-1976 cumulative taxable gifts per grantor.
   *  Sourced from PlanSettings.priorTaxableGifts. */
  priorTaxableGifts: { client: number; spouse: number };
  /** Engine-published locked entity slice EoY for the death year (entityId →
   *  accountId → dollars). When provided, threaded into computeGrossEstate so
   *  the joint / mixed-ownership branch computes the family pool as
   *  `fmv − Σ locked entity shares` instead of `fmv × pct`. Same shape as
   *  ProjectionYear.entityAccountSharesEoY. Optional — fallback is the legacy
   *  `fmv × pct` per the existing computeGrossEstate logic. */
  entityAccountSharesEoY?: Map<string, Map<string, number>>;
  /** Engine-published locked family-member slice EoY for the death year
   *  (fmId → accountId → dollars). Currently unused inside computeGrossEstate;
   *  reserved for future per-FM gross-estate attribution. The same data is
   *  actively consumed by the balance sheet, in-estate-at-year, and the
   *  yearly-liquidity report. */
  familyAccountSharesEoY?: Map<string, Map<string, number>>;
}

export interface DeathEventResult {
  accounts: Account[];
  accountBalances: Record<string, number>;
  basisMap: Record<string, number>;
  incomes: Income[];
  liabilities: Liability[];
  transfers: DeathTransfer[];
  warnings: string[];
  estateTax: EstateTaxResult;
  dsueGenerated: number;   // first-death only; always 0 at final death
  /** Mutated entity list after grantor-succession updates have been applied.
   *  Caller threads this forward so trust-tax classification (grantor vs.
   *  non-grantor) re-evaluates against post-death state in subsequent years.
   *  When no entityUpdates fire, this is identity-equal to `input.entities`. */
  entities: EntitySummary[];
}

/** Step 4: Fallback chain. Routes the undisposed residual to:
 *    tier 1 — surviving spouse (4b: always fires here)
 *    tier 2 — even split across living children (4c territory; dead code in 4b)
 *    tier 3 — "Other Heirs" system-default sink
 *  Always emits `residual_fallback_fired` warning when it fires.
 */
export function applyFallback(
  source: Account,
  undisposedFraction: number,
  survivor: "client" | "spouse" | null,
  survivorFmId: string | null,
  familyMembers: FamilyMember[],
  linkedLiability: Liability | undefined,
): { step: StepResult; warnings: string[] } {
  if (undisposedFraction < 1e-9) {
    return { step: empty(), warnings: [] };
  }

  const warnings = [`residual_fallback_fired:${source.id}`];

  // Scale source + liability to the residual portion; normalize shares to sum=1.
  const scaledSource: Account = {
    ...source,
    value: source.value * undisposedFraction,
    basis: source.basis * undisposedFraction,
  };
  const scaledLiability: Liability | undefined = linkedLiability
    ? {
        ...linkedLiability,
        balance: linkedLiability.balance * undisposedFraction,
        monthlyPayment: linkedLiability.monthlyPayment * undisposedFraction,
      }
    : undefined;

  // Tier 1
  if (survivor && survivorFmId != null) {
    const split = splitAccount(
      scaledSource,
      [{
        fraction: 1,
        ownerMutation: { owners: [{ kind: "family_member", familyMemberId: survivorFmId, percent: 1 }] },
        ledgerMeta: {
          via: "fallback_spouse",
          recipientKind: "spouse",
          recipientId: survivorFmId,
          recipientLabel: "Spouse",
        },
      }],
      scaledLiability,
    );
    return {
      step: {
        consumed: true,
        resultingAccounts: split.resultingAccounts,
        resultingLiabilities: split.resultingLiabilities,
        ledgerEntries: split.ledgerEntries,
        fractionClaimed: undisposedFraction,
      },
      warnings,
    };
  }

  // Tier 2 — living children. "Living" = no dateOfDeath field today; assume
  // all listed children are living. (See future-work fallback_children_recipient_deceased.)
  // Exclude household principals (role=client/spouse) — they're grantors, not heirs,
  // even if their FamilyMember row carries a stale relationship: "child" value.
  const children = familyMembers.filter(
    (f) => f.relationship === "child" && f.role !== "client" && f.role !== "spouse",
  );
  if (children.length > 0) {
    const perChild = 1 / children.length;
    const shares: SplitShare[] = children.map((c) => ({
      fraction: perChild,
      ownerMutation: { owners: [{ kind: "family_member", familyMemberId: c.id, percent: 1 }] },
      ledgerMeta: {
        via: "fallback_children" as const,
        recipientKind: "family_member" as const,
        recipientId: c.id,
        recipientLabel: `${c.firstName}${c.lastName ? " " + c.lastName : ""}`,
      },
    }));
    const split = splitAccount(scaledSource, shares, scaledLiability);
    return {
      step: {
        consumed: true,
        resultingAccounts: split.resultingAccounts,
        resultingLiabilities: split.resultingLiabilities,
        ledgerEntries: split.ledgerEntries,
        fractionClaimed: undisposedFraction,
      },
      warnings,
    };
  }

  // Tier 3 — Other Heirs sink; account is removed from state.
  const split = splitAccount(
    scaledSource,
    [{
      fraction: 1,
      removed: true,
      ledgerMeta: {
        via: "fallback_other_heirs" as const,
        recipientKind: "system_default" as const,
        recipientId: null,
        recipientLabel: "Other Heirs",
      },
    }],
    scaledLiability,
  );
  return {
    step: {
      consumed: true,
      resultingAccounts: split.resultingAccounts,
      resultingLiabilities: split.resultingLiabilities,
      ledgerEntries: split.ledgerEntries,
      fractionClaimed: undisposedFraction,
    },
    warnings,
  };
}

export interface RunPourOutInput {
  queue: Array<{ entityId: string; trustBeneficiaries: BeneficiaryRef[] }>;
  deceased: "client" | "spouse";
  deathOrder: 1 | 2;
  accounts: Account[];
  accountBalances: Record<string, number>;
  basisMap: Record<string, number>;
  liabilities: Liability[];
  familyMembers: FamilyMember[];
  externalBeneficiaries: ExternalBeneficiarySummary[];
  entities: EntitySummary[];
  year: number;
}

export interface RunPourOutResult {
  transfers: DeathTransfer[];
  liabilities: Liability[];
  warnings: string[];
}

/** Trust pour-out distribution. When a grantor-revocable trust flips to
 *  irrevocable at the grantor's death, the trust's accounts and unlinked
 *  debts pour out to its beneficiaries per their BeneficiaryRef percentages.
 *  Emits one ledger entry per (account, beneficiary) pair with via="trust_pour_out".
 *  Trust liabilities have their owners[] cleared so downstream
 *  distributeUnlinkedLiabilities can redistribute them with the rest.
 *
 *  Fallbacks:
 *    - bens empty or totalPct===0 → entire balance routes to "Other Heirs"
 *      system_default sink + emits `trust_pour_out_fallback_fired`.
 *    - 0 < totalPct < 99.99 → emits `trust_beneficiaries_incomplete`
 *      warning and distributes per the stated pcts (no normalization). */
export function runPourOut(input: RunPourOutInput): RunPourOutResult {
  const transfers: DeathTransfer[] = [];
  const warnings: string[] = [];
  let workingLiabs = [...input.liabilities];

  for (const q of input.queue) {
    const trustAccounts = input.accounts.filter((a) => controllingEntity(a) === q.entityId);
    const bens = q.trustBeneficiaries;
    const totalPct = bens.reduce((s, b) => s + b.percentage, 0);

    if (totalPct < 99.99 && totalPct > 0) {
      warnings.push(`trust_beneficiaries_incomplete: ${q.entityId} (sum=${totalPct}%)`);
    }

    for (const acct of trustAccounts) {
      const balance = input.accountBalances[acct.id] ?? 0;
      if (balance <= 0) continue;

      // §1014 step-up at the grantor's death. Pour-out only fires for
      // entities in the queue — which is exactly the set of revocable
      // trusts flipping to irrevocable now, i.e., assets that were in the
      // grantor's gross estate. Trust accounts are never joint, so
      // isJointAtFirstDeath is always false. Retirement-in-trust is an
      // edge case: the helper returns originalBasis unchanged.
      const originalBasis = input.basisMap[acct.id] ?? acct.basis;
      const steppedBasis = computeSteppedUpBasis(
        acct.category, balance, originalBasis,
        { isJointAtFirstDeath: false },
      );

      if (bens.length === 0 || totalPct === 0) {
        transfers.push(makePourOutTransfer({
          year: input.year,
          deathOrder: input.deathOrder,
          deceased: input.deceased,
          sourceAccountId: acct.id,
          sourceAccountName: acct.name,
          recipientKind: "system_default",
          recipientId: null,
          recipientLabel: "Other Heirs",
          amount: balance,
          basis: steppedBasis,
        }));
        warnings.push(`trust_pour_out_fallback_fired: ${q.entityId}`);
        continue;
      }

      for (const b of bens) {
        const share = (b.percentage / 100) * balance;
        const shareBasis = (b.percentage / 100) * steppedBasis;
        const { recipientKind, recipientId, label } = resolveTrustBeneRecipient(
          b, input.familyMembers, input.externalBeneficiaries,
        );
        transfers.push(makePourOutTransfer({
          year: input.year,
          deathOrder: input.deathOrder,
          deceased: input.deceased,
          sourceAccountId: acct.id,
          sourceAccountName: acct.name,
          recipientKind,
          recipientId,
          recipientLabel: label,
          amount: share,
          basis: shareBasis,
        }));
      }
    }

    // Strip the entity ownership from trust liabilities so distributeUnlinkedLiabilities
    // can redistribute them with the rest of the household unlinked debt.
    workingLiabs = workingLiabs.map((l) =>
      controllingEntity(l) === q.entityId
        ? { ...l, owners: [] }
        : l,
    );
  }

  return { transfers, liabilities: workingLiabs, warnings };
}

function makePourOutTransfer(input: {
  year: number;
  deathOrder: 1 | 2;
  deceased: "client" | "spouse";
  sourceAccountId: string;
  sourceAccountName: string;
  recipientKind: DeathTransfer["recipientKind"];
  recipientId: string | null;
  recipientLabel: string;
  amount: number;
  basis: number;
}): DeathTransfer {
  return {
    year: input.year,
    deathOrder: input.deathOrder,
    deceased: input.deceased,
    sourceAccountId: input.sourceAccountId,
    sourceAccountName: input.sourceAccountName,
    sourceLiabilityId: null,
    sourceLiabilityName: null,
    via: "trust_pour_out",
    recipientKind: input.recipientKind,
    recipientId: input.recipientId,
    recipientLabel: input.recipientLabel,
    amount: input.amount,
    basis: input.basis,
    resultingAccountId: null,
    resultingLiabilityId: null,
  };
}

function resolveTrustBeneRecipient(
  b: BeneficiaryRef,
  familyMembers: FamilyMember[],
  externals: ExternalBeneficiarySummary[],
): { recipientKind: DeathTransfer["recipientKind"]; recipientId: string | null; label: string } {
  if (b.familyMemberId) {
    const fm = familyMembers.find((m) => m.id === b.familyMemberId);
    return {
      recipientKind: "family_member",
      recipientId: b.familyMemberId,
      label: fm
        ? `${fm.firstName}${fm.lastName ? " " + fm.lastName : ""}`
        : "Family member",
    };
  }
  if (b.externalBeneficiaryId) {
    const ext = externals.find((e) => e.id === b.externalBeneficiaryId);
    return {
      recipientKind: "external_beneficiary",
      recipientId: b.externalBeneficiaryId,
      label: ext?.name ?? "External beneficiary",
    };
  }
  return { recipientKind: "system_default", recipientId: null, label: "Other Heirs" };
}
