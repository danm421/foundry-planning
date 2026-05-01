import type { ClientInfo, Account, Liability, DeathTransfer, EstateTaxResult, FamilyMember, Will, WillBequest, EntitySummary, Income, PlanSettings, Gift, GiftEvent, BeneficiaryRef } from "../types";
import { nextSyntheticId } from "../asset-transactions";
import type { FilingStatus } from "../../lib/tax/types";
import type { AccountOwner } from "../ownership";
import { controllingEntity, isFullyEntityOwned, ownedByHousehold } from "../ownership";

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

    let newAccount: Account;
    if (inPlace) {
      // Mutate original: keep id, name, value, basis unchanged.
      newAccount = {
        ...source,
        beneficiaries: undefined, // new owner's designations replace deceased's (if any)
      };
    } else {
      newAccount = {
        ...source,
        id: nextSyntheticId("death-acct"),
        name: `${source.name} — to ${share.ledgerMeta.recipientLabel}`,
        value: amount,
        basis: basisShare,
        beneficiaries: undefined,
      };
    }

    // Apply owner mutation: replace owners[] with the post-transfer ownership.
    if (share.ownerMutation) {
      newAccount.owners = share.ownerMutation.owners;
    }

    resultingAccounts.push(newAccount);

    // Liability follow-through: one liability per kept share, proportional
    let resultingLiabilityId: string | null = null;
    if (linkedLiability) {
      if (inPlace) {
        resultingLiabilities.push({
          ...linkedLiability,
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
          recipientId: null,
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

/** Step 2: Primary beneficiary designations on the account. Returns
 *  fractionClaimed ≤ undisposedFraction. When designations sum to full
 *  coverage of the undisposed remainder, consumed=true. */
export function applyBeneficiaryDesignations(
  source: Account,
  undisposedFraction: number,
  familyMembers: FamilyMember[],
  externals: ExternalBeneficiarySummary[],
  linkedLiability: Liability | undefined,
): StepResult {
  const primaries = (source.beneficiaries ?? []).filter(
    (b) => b.tier === "primary",
  );
  if (primaries.length === 0) {
    return {
      consumed: false,
      resultingAccounts: [],
      resultingLiabilities: [],
      ledgerEntries: [],
      fractionClaimed: 0,
    };
  }

  const famMap = new Map(familyMembers.map((f) => [f.id, f]));
  const extMap = new Map(externals.map((e) => [e.id, e]));

  const shares: SplitShare[] = primaries.map((b) => {
    const fraction = undisposedFraction * (b.percentage / 100);
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
    } else {
      // Defensive — shouldn't happen if API validation is intact.
      removed = true;
      recipientKind = "external_beneficiary";
      recipientId = null;
      recipientLabel = "Unknown beneficiary";
    }

    return {
      fraction,
      removed: removed || undefined,
      ownerMutation,
      ledgerMeta: {
        via: "beneficiary_designation",
        recipientKind,
        recipientId,
        recipientLabel,
      },
    };
  });

  const totalClaimed = shares.reduce((s, sh) => s + sh.fraction, 0);

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
      recipientId: null,
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

  if (specifics.length === 0) {
    return {
      consumed: false,
      resultingAccounts: [],
      resultingLiabilities: [],
      ledgerEntries: [],
      fractionClaimed: 0,
      warnings: [],
    };
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

/** Feature A — proportional distribution of unlinked household liabilities.
 *  Runs after the asset precedence chain at 4c. For each unlinked liability
 *  (linkedPropertyId null AND ownerEntityId null), each final-tier recipient
 *  receives balance × (their share of the estate) either as a new
 *  family-member-owned liability row (kept in model) or as a ledger-only
 *  entry (external / system_default — liability leaves the model with the
 *  asset share).
 *
 *  Deceased with zero-estate but nonzero unlinked debt: liability is
 *  dropped and a warning is emitted. */
export function distributeUnlinkedLiabilities(
  liabilities: Liability[],
  assetTransfers: DeathTransfer[],
  year: number,
  deceased: "client" | "spouse",
): UnlinkedLiabilityDistributionResult {
  const unlinked = liabilities.filter(
    (l) => l.linkedPropertyId == null && !isFullyEntityOwned(l),
  );

  if (unlinked.length === 0) {
    return { updatedLiabilities: liabilities, liabilityTransfers: [], warnings: [] };
  }

  // Group asset transfers by (recipientKind, recipientId, recipientLabel) to
  // compute each recipient's total share. Use a composite key so recipients
  // with null ids (spouse / system_default) don't collide.
  type RecipientKey = string;
  const keyOf = (t: DeathTransfer): RecipientKey =>
    `${t.recipientKind}|${t.recipientId ?? ""}|${t.recipientLabel}`;

  const totalsByRecipient = new Map<
    RecipientKey,
    { kind: DeathTransfer["recipientKind"]; id: string | null; label: string; amount: number }
  >();
  let estateTotal = 0;

  for (const t of assetTransfers) {
    estateTotal += t.amount;
    const k = keyOf(t);
    const prev = totalsByRecipient.get(k);
    if (prev) {
      prev.amount += t.amount;
    } else {
      totalsByRecipient.set(k, {
        kind: t.recipientKind,
        id: t.recipientId,
        label: t.recipientLabel,
        amount: t.amount,
      });
    }
  }

  const warnings: string[] = [];

  // 4e: Filter out recipients whose net ledger amount is ≤ 0. Liability
  // bequests create negative ledger entries; a recipient with only a
  // bequest debt (no asset inheritance) must not be assigned additional
  // residual debt.
  for (const [key, rec] of totalsByRecipient.entries()) {
    if (rec.amount <= 0) {
      warnings.push(`liability_bequest_recipient_no_asset_share:${rec.id ?? rec.label}`);
      totalsByRecipient.delete(key);
    }
  }

  // Recompute estateTotal from only the positive-net recipients so
  // shares stay consistent.
  estateTotal = 0;
  for (const rec of totalsByRecipient.values()) estateTotal += rec.amount;
  const liabilityTransfers: DeathTransfer[] = [];
  const newLiabilityRows: Liability[] = [];
  const removedLiabilityIds = new Set<string>();

  for (const liab of unlinked) {
    if (estateTotal <= 0) {
      warnings.push(`unlinked_liability_no_estate_recipient:${liab.id}`);
      removedLiabilityIds.add(liab.id);
      continue;
    }

    for (const rec of totalsByRecipient.values()) {
      const share = rec.amount / estateTotal;
      const shareBalance = liab.balance * share;
      const sharePayment = liab.monthlyPayment * share;

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
          ownerFamilyMemberId: rec.id,  // kept: signals "distributed-to-heir" semantics (not a legacy owner column)
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
          recipientId: null,
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
