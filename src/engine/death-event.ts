import type { ClientInfo, Account, Liability, DeathTransfer, EstateTaxResult, FamilyMember, Will, WillBequest, EntitySummary, Income } from "./types";
import { nextSyntheticId } from "./asset-transactions";

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
  owner?: "client" | "spouse";
  ownerFamilyMemberId?: string;
  ownerEntityId?: string;
};

export type SplitShare = {
  /** 0 < fraction ≤ 1. Sum of all shares' fractions must equal 1. */
  fraction: number;
  /** When true, this share produces NO resulting account — the value leaves
   *  the household. Still emits a ledger entry. */
  removed?: boolean;
  /** When !removed, the mutation to apply to the resulting account's owner
   *  fields. Exactly one of owner / ownerFamilyMemberId / ownerEntityId
   *  should be set. */
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

    // Apply owner mutation. Explicit assigns overwrite existing values so the
    // deceased's ownerFamilyMemberId/ownerEntityId never linger onto a spouse-
    // owned account.
    if (share.ownerMutation) {
      if (share.ownerMutation.owner !== undefined) {
        newAccount.owner = share.ownerMutation.owner;
        newAccount.ownerFamilyMemberId = undefined;
        newAccount.ownerEntityId = undefined;
      } else if (share.ownerMutation.ownerFamilyMemberId !== undefined) {
        newAccount.ownerFamilyMemberId = share.ownerMutation.ownerFamilyMemberId;
        newAccount.ownerEntityId = undefined;
      } else if (share.ownerMutation.ownerEntityId !== undefined) {
        newAccount.ownerEntityId = share.ownerMutation.ownerEntityId;
        newAccount.ownerFamilyMemberId = undefined;
      }
    }

    resultingAccounts.push(newAccount);

    // Liability follow-through: one liability per kept share, proportional
    if (linkedLiability) {
      if (inPlace) {
        resultingLiabilities.push({
          ...linkedLiability,
          // id and linkedPropertyId unchanged (account kept its id)
        });
      } else {
        resultingLiabilities.push({
          ...linkedLiability,
          id: nextSyntheticId("death-liab"),
          balance: linkedLiability.balance * share.fraction,
          monthlyPayment: linkedLiability.monthlyPayment * share.fraction,
          linkedPropertyId: newAccount.id,
        });
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

interface ExternalBeneficiarySummary {
  id: string;
  name: string;
  kind?: "charity" | "individual";
}

/** Step 1: Titling. Joint accounts pass 100% to the survivor via right-of-
 *  survivorship. Non-joint accounts pass through unchanged. */
export function applyTitling(
  source: Account,
  survivor: "client" | "spouse",
  linkedLiability: Liability | undefined,
): StepResult {
  if (source.owner !== "joint") {
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
        ownerMutation: { owner: survivor },
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
      ownerMutation = { ownerFamilyMemberId: b.familyMemberId };
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
  survivor: "client" | "spouse" | null,
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
      ownerMutation: survivor ? { owner: survivor } : undefined,
      removed: false,
      recipientKind: "spouse",
      recipientId: null,
      recipientLabel: "Spouse",
    };
  }
  if (r.recipientKind === "family_member") {
    const fam = familyMembers.find((f) => f.id === r.recipientId);
    return {
      ownerMutation: { ownerFamilyMemberId: r.recipientId! },
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
      ownerMutation: { ownerEntityId: r.recipientId! },
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
  familyMembers: FamilyMember[],
  externals: ExternalBeneficiarySummary[],
  entities: EntitySummary[],
  linkedLiability: Liability | undefined,
): StepResult & { warnings: string[] } {
  const specifics = will.bequests.filter(
    (b) =>
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
        resolveRecipientLabelAndMutation(r, survivor, familyMembers, externals, entities);
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
  familyMembers: FamilyMember[],
  externals: ExternalBeneficiarySummary[],
  entities: EntitySummary[],
  linkedLiability: Liability | undefined,
): StepResult {
  if (accountTouchedBySpecific) {
    return empty();
  }
  const allAssets = will.bequests.filter(
    (b) => b.assetMode === "all_assets" && firesAtDeath(b, deathOrder),
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
        resolveRecipientLabelAndMutation(r, survivor, familyMembers, externals, entities);
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

import type { FilingStatus } from "../lib/tax/types";

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
    (l) => l.linkedPropertyId == null && l.ownerEntityId == null,
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
          ownerFamilyMemberId: rec.id,
          isInterestDeductible: liab.isInterestDeductible,
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
}

/** Orchestrator. Applies the precedence chain (titling → bene-designations →
 *  will → fallback) to every account touched by the deceased, and clips the
 *  deceased's personal income streams. Returns fully-updated engine state +
 *  a transfer ledger + any warnings. */
export function applyFirstDeath(input: DeathEventInput): DeathEventResult {
  const {
    year, deceased, survivor, will,
    accounts, accountBalances, basisMap,
    incomes, liabilities,
    familyMembers, externalBeneficiaries, entities,
  } = input;

  const nextAccounts: Account[] = [];
  const nextLiabilities: Liability[] = [...liabilities];
  const nextAccountBalances: Record<string, number> = { ...accountBalances };
  const nextBasisMap: Record<string, number> = { ...basisMap };
  const transfers: DeathTransfer[] = [];
  const warnings: string[] = [];

  // Build a per-will map for quick lookups. Only the deceased's will matters.
  const deceasedWill: Will | null = will && will.grantor === deceased ? will : null;

  for (const acct of accounts) {
    // Accounts not touched by the deceased pass through unchanged.
    const touchedByDeceased =
      acct.owner === deceased || acct.owner === "joint";
    if (!touchedByDeceased || acct.ownerEntityId || acct.ownerFamilyMemberId) {
      nextAccounts.push(acct);
      continue;
    }

    // Collect the linked liability (if any) — we'll replace it on the
    // accumulator list once we know what the account split becomes.
    const linkedLiability = liabilities.find((l) => l.linkedPropertyId === acct.id);

    // Build an adjusted copy that carries the current (grown) balance and basis.
    // workingAccounts[i].value is a snapshot from plan-start and never updated
    // year-over-year; the authoritative grown value lives in accountBalances[id].
    const balance = accountBalances[acct.id];
    const basis = basisMap[acct.id];
    if (balance == null || basis == null) {
      throw new Error(
        `applyFirstDeath: missing accountBalances/basisMap entry for ${acct.id}`,
      );
    }
    const effectiveAcct: Account = { ...acct, value: balance, basis };

    // Track remaining undisposed fraction for this account.
    let undisposed = acct.owner === "joint" ? 1 : 1; // either way, the account goes through steps
    let anySpecificClauseTouched = false;
    const stepAccts: Account[] = [];
    const stepLiabs: Liability[] = [];
    const stepLedger: Array<Omit<DeathTransfer, "year" | "deceased" | "deathOrder">> = [];

    // Step 1: Titling
    const step1 = applyTitling(effectiveAcct, survivor, linkedLiability);
    if (step1.consumed) {
      stepAccts.push(...step1.resultingAccounts);
      stepLiabs.push(...step1.resultingLiabilities);
      stepLedger.push(...step1.ledgerEntries);
      undisposed = 0;
    }

    // Step 2: Beneficiary designations
    if (undisposed > 1e-9) {
      const step2 = applyBeneficiaryDesignations(
        effectiveAcct, undisposed,
        familyMembers, externalBeneficiaries, linkedLiability,
      );
      if (step2.fractionClaimed > 0) {
        stepAccts.push(...step2.resultingAccounts);
        stepLiabs.push(...step2.resultingLiabilities);
        stepLedger.push(...step2.ledgerEntries);
        undisposed -= step2.fractionClaimed;
      }
    }

    // Step 3a: Specific bequests
    if (undisposed > 1e-9 && deceasedWill) {
      const step3a = applyWillSpecificBequests(
        effectiveAcct, undisposed, deceasedWill, 1, survivor,
        familyMembers, externalBeneficiaries, entities, linkedLiability,
      );
      if (step3a.fractionClaimed > 0) {
        stepAccts.push(...step3a.resultingAccounts);
        stepLiabs.push(...step3a.resultingLiabilities);
        stepLedger.push(...step3a.ledgerEntries);
        undisposed -= step3a.fractionClaimed;
        anySpecificClauseTouched = true;
        warnings.push(...step3a.warnings);
      }
    }

    // Step 3b: all_assets residual (only if no specific clause touched this account)
    if (undisposed > 1e-9 && deceasedWill) {
      const step3b = applyWillAllAssetsResidual(
        effectiveAcct, undisposed, anySpecificClauseTouched, deceasedWill, 1, survivor,
        familyMembers, externalBeneficiaries, entities, linkedLiability,
      );
      if (step3b.fractionClaimed > 0) {
        stepAccts.push(...step3b.resultingAccounts);
        stepLiabs.push(...step3b.resultingLiabilities);
        stepLedger.push(...step3b.ledgerEntries);
        undisposed -= step3b.fractionClaimed;
      }
    }

    // Step 4: Fallback
    if (undisposed > 1e-9) {
      const step4 = applyFallback(
        effectiveAcct, undisposed, survivor, familyMembers, linkedLiability,
      );
      stepAccts.push(...step4.step.resultingAccounts);
      stepLiabs.push(...step4.step.resultingLiabilities);
      stepLedger.push(...step4.step.ledgerEntries);
      warnings.push(...step4.warnings);
      undisposed = 0;
    }

    // Emit ledger (with year + deceased + deathOrder populated) and fold accumulators
    for (const entry of stepLedger) {
      transfers.push({ ...entry, year, deceased, deathOrder: 1 });
    }

    // Replace `acct` in the accounts list with the step-produced accounts.
    // Also: remove the old account's balance / basis maps and add new ones.
    delete nextAccountBalances[acct.id];
    delete nextBasisMap[acct.id];
    for (const a of stepAccts) {
      nextAccounts.push(a);
      nextAccountBalances[a.id] = a.value;
      nextBasisMap[a.id] = a.basis;
    }

    // Swap liability records: drop the original linked liability (if any) and
    // add the new split liabilities.
    if (linkedLiability) {
      const idx = nextLiabilities.findIndex((l) => l.id === linkedLiability.id);
      if (idx >= 0) nextLiabilities.splice(idx, 1);
      for (const lib of stepLiabs) nextLiabilities.push(lib);
    }
  }

  // Income termination
  const nextIncomes = applyIncomeTermination(incomes, deceased, survivor, year);

  const result: DeathEventResult = {
    accounts: nextAccounts,
    accountBalances: nextAccountBalances,
    basisMap: nextBasisMap,
    incomes: nextIncomes,
    liabilities: nextLiabilities,
    transfers,
    warnings,
  };

  assertInvariants(result, input);

  return result;
}

/** Post-event invariant checks. Violations indicate a routing bug. */
function assertInvariants(result: DeathEventResult, input: DeathEventInput): void {
  // 1. Sum of ledger amounts grouped by source = each source's pre-death value
  //    (skip liability-only transfers which have null sourceAccountId)
  const bySource = new Map<string, number>();
  for (const t of result.transfers) {
    if (t.sourceAccountId == null) continue;
    bySource.set(t.sourceAccountId, (bySource.get(t.sourceAccountId) ?? 0) + t.amount);
  }
  for (const [sourceId, summed] of bySource.entries()) {
    const originalBalance = input.accountBalances[sourceId];
    if (originalBalance == null) continue;
    if (Math.abs(summed - originalBalance) > 0.01) {
      throw new Error(
        `applyFirstDeath invariant: ledger sum for ${sourceId} = ${summed}, expected ${originalBalance}`,
      );
    }
  }
  // 2. No deceased-owner orphan accounts (no entity/family-member tag, owner = deceased)
  for (const a of result.accounts) {
    if (
      a.owner === input.deceased &&
      !a.ownerEntityId &&
      !a.ownerFamilyMemberId
    ) {
      throw new Error(
        `applyFirstDeath invariant: account ${a.id} still has deceased as sole owner`,
      );
    }
  }
  // 3. No personal (non-entity) deceased-owner incomes active after deathYear
  for (const inc of result.incomes) {
    if (
      !inc.ownerEntityId &&
      inc.owner === input.deceased &&
      inc.endYear > input.year
    ) {
      throw new Error(
        `applyFirstDeath invariant: income ${inc.id} still active after death year`,
      );
    }
  }
}

/** 4c orchestrator — final-death asset transfer. Runs the precedence chain
 *  (step 1 titling is inert; step 2 designations; step 3 will with
 *  deathOrder=2 condition filter; step 4 fallback with survivor=null so
 *  tier 1 is skipped and tiers 2/3 handle the residual), distributes
 *  unlinked household liabilities proportionally to final-tier recipients,
 *  terminates the deceased's personal income streams, and asserts
 *  4c-specific invariants. */
export function applyFinalDeath(input: DeathEventInput): DeathEventResult {
  const {
    year, deceased, will,
    accounts, accountBalances, basisMap,
    incomes, liabilities,
    familyMembers, externalBeneficiaries, entities,
  } = input;

  // Defensive: no joint accounts can exist at 4c.
  for (const a of accounts) {
    if (a.owner === "joint") {
      throw new Error(
        `applyFinalDeath invariant: account ${a.id} still has owner='joint' at final death (should have been retitled at 4b)`,
      );
    }
  }

  const nextAccounts: Account[] = [];
  const nextLiabilities: Liability[] = [...liabilities];
  const nextAccountBalances: Record<string, number> = { ...accountBalances };
  const nextBasisMap: Record<string, number> = { ...basisMap };
  const assetTransfers: DeathTransfer[] = [];
  const warnings: string[] = [];

  const deceasedWill: Will | null = will && will.grantor === deceased ? will : null;

  for (const acct of accounts) {
    const touchedByDeceased = acct.owner === deceased;
    if (!touchedByDeceased || acct.ownerEntityId || acct.ownerFamilyMemberId) {
      nextAccounts.push(acct);
      continue;
    }

    const linkedLiability = liabilities.find((l) => l.linkedPropertyId === acct.id);

    const balance = accountBalances[acct.id];
    const basis = basisMap[acct.id];
    if (balance == null || basis == null) {
      throw new Error(
        `applyFinalDeath: missing accountBalances/basisMap entry for ${acct.id}`,
      );
    }
    const effectiveAcct: Account = { ...acct, value: balance, basis };

    let undisposed = 1;
    let anySpecificClauseTouched = false;
    const stepAccts: Account[] = [];
    const stepLiabs: Liability[] = [];
    const stepLedger: Array<Omit<DeathTransfer, "year" | "deceased" | "deathOrder">> = [];

    // Step 1 is a no-op at 4c (no joint accounts). Skip directly to step 2.

    // Step 2: Beneficiary designations
    const step2 = applyBeneficiaryDesignations(
      effectiveAcct, undisposed,
      familyMembers, externalBeneficiaries, linkedLiability,
    );
    if (step2.fractionClaimed > 0) {
      stepAccts.push(...step2.resultingAccounts);
      stepLiabs.push(...step2.resultingLiabilities);
      stepLedger.push(...step2.ledgerEntries);
      undisposed -= step2.fractionClaimed;
    }

    // Step 3a: Specific bequests (deathOrder=2)
    if (undisposed > 1e-9 && deceasedWill) {
      const step3a = applyWillSpecificBequests(
        effectiveAcct, undisposed, deceasedWill, 2, null,
        familyMembers, externalBeneficiaries, entities, linkedLiability,
      );
      if (step3a.fractionClaimed > 0) {
        stepAccts.push(...step3a.resultingAccounts);
        stepLiabs.push(...step3a.resultingLiabilities);
        stepLedger.push(...step3a.ledgerEntries);
        undisposed -= step3a.fractionClaimed;
        anySpecificClauseTouched = true;
        warnings.push(...step3a.warnings);
      }
    }

    // Step 3b: all_assets residual (deathOrder=2)
    if (undisposed > 1e-9 && deceasedWill) {
      const step3b = applyWillAllAssetsResidual(
        effectiveAcct, undisposed, anySpecificClauseTouched, deceasedWill, 2, null,
        familyMembers, externalBeneficiaries, entities, linkedLiability,
      );
      if (step3b.fractionClaimed > 0) {
        stepAccts.push(...step3b.resultingAccounts);
        stepLiabs.push(...step3b.resultingLiabilities);
        stepLedger.push(...step3b.ledgerEntries);
        undisposed -= step3b.fractionClaimed;
      }
    }

    // Step 4: Fallback with survivor=null — tier 1 skipped; tiers 2/3 live.
    if (undisposed > 1e-9) {
      const step4 = applyFallback(
        effectiveAcct, undisposed, null, familyMembers, linkedLiability,
      );
      stepAccts.push(...step4.step.resultingAccounts);
      stepLiabs.push(...step4.step.resultingLiabilities);
      stepLedger.push(...step4.step.ledgerEntries);
      warnings.push(...step4.warnings);
      undisposed = 0;
    }

    for (const entry of stepLedger) {
      assetTransfers.push({ ...entry, year, deceased, deathOrder: 2 });
    }

    delete nextAccountBalances[acct.id];
    delete nextBasisMap[acct.id];
    for (const a of stepAccts) {
      nextAccounts.push(a);
      nextAccountBalances[a.id] = a.value;
      nextBasisMap[a.id] = a.basis;
    }

    if (linkedLiability) {
      const idx = nextLiabilities.findIndex((l) => l.id === linkedLiability.id);
      if (idx >= 0) nextLiabilities.splice(idx, 1);
      for (const lib of stepLiabs) nextLiabilities.push(lib);
    }
  }

  // Unlinked household liability distribution (Feature A).
  const unlinkedResult = distributeUnlinkedLiabilities(
    nextLiabilities, assetTransfers, year, deceased,
  );
  const allTransfers = [...assetTransfers, ...unlinkedResult.liabilityTransfers];
  warnings.push(...unlinkedResult.warnings);

  // Income termination — reuse the 4b helper. At 4c there are no joint
  // accounts to retitle; the survivor arg to the helper is only used for
  // joint-income retitling and doesn't matter here, so we pass deceased.
  const nextIncomes = applyIncomeTermination(incomes, deceased, deceased, year);

  const result: DeathEventResult = {
    accounts: nextAccounts,
    accountBalances: nextAccountBalances,
    basisMap: nextBasisMap,
    incomes: nextIncomes,
    liabilities: unlinkedResult.updatedLiabilities,
    transfers: allTransfers,
    warnings,
  };

  assertFinalDeathInvariants(result, input);

  return result;
}

function assertFinalDeathInvariants(result: DeathEventResult, input: DeathEventInput): void {
  // 1. No transfer has recipientKind === "spouse" — tier 1 is skipped at 4c,
  //    and a will/designation routing to the deceased's already-deceased spouse
  //    is bad data. Check this first so the error is maximally informative.
  for (const t of result.transfers) {
    if (t.recipientKind === "spouse") {
      throw new Error(
        `applyFinalDeath invariant: transfer for ${t.sourceAccountId ?? t.sourceLiabilityId} routes to spouse at final death`,
      );
    }
  }

  // 2. Sum of asset transfer amounts grouped by source = each source's pre-death balance.
  const bySource = new Map<string, number>();
  for (const t of result.transfers) {
    if (t.sourceAccountId == null) continue;  // skip liability transfers
    bySource.set(t.sourceAccountId, (bySource.get(t.sourceAccountId) ?? 0) + t.amount);
  }
  for (const [sourceId, summed] of bySource.entries()) {
    const originalBalance = input.accountBalances[sourceId];
    if (originalBalance == null) continue;
    if (Math.abs(summed - originalBalance) > 0.01) {
      throw new Error(
        `applyFinalDeath invariant: asset ledger sum for ${sourceId} = ${summed}, expected ${originalBalance}`,
      );
    }
  }

  // 3. Sum of liability transfer amounts grouped by source = -(liability balance).
  const byLiability = new Map<string, number>();
  for (const t of result.transfers) {
    if (t.sourceLiabilityId == null) continue;
    byLiability.set(
      t.sourceLiabilityId,
      (byLiability.get(t.sourceLiabilityId) ?? 0) + t.amount,
    );
  }
  for (const [liabId, summed] of byLiability.entries()) {
    const liab = input.liabilities.find((l) => l.id === liabId);
    if (!liab) continue;
    if (Math.abs(-summed - liab.balance) > 0.01) {
      throw new Error(
        `applyFinalDeath invariant: liability ledger sum for ${liabId} = ${summed}, expected ${-liab.balance}`,
      );
    }
  }

  // 4. No deceased-owner orphan accounts remain.
  for (const a of result.accounts) {
    if (
      a.owner === input.deceased &&
      !a.ownerEntityId &&
      !a.ownerFamilyMemberId
    ) {
      throw new Error(
        `applyFinalDeath invariant: account ${a.id} still has deceased as sole owner`,
      );
    }
  }

  // 5. No account remains with owner='joint' (should have been caught up-front).
  for (const a of result.accounts) {
    if (a.owner === "joint") {
      throw new Error(
        `applyFinalDeath invariant: account ${a.id} owner='joint' after event`,
      );
    }
  }

  // 6. No personal (non-entity) deceased-owner incomes active past deathYear.
  for (const inc of result.incomes) {
    if (
      !inc.ownerEntityId &&
      inc.owner === input.deceased &&
      inc.endYear > input.year
    ) {
      throw new Error(
        `applyFinalDeath invariant: income ${inc.id} still active after final-death year`,
      );
    }
  }
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
  if (survivor) {
    const split = splitAccount(
      scaledSource,
      [{
        fraction: 1,
        ownerMutation: { owner: survivor },
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
  const children = familyMembers.filter((f) => f.relationship === "child");
  if (children.length > 0) {
    const perChild = 1 / children.length;
    const shares: SplitShare[] = children.map((c) => ({
      fraction: perChild,
      ownerMutation: { ownerFamilyMemberId: c.id },
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
