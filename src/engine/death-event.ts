import type { ClientInfo, Account, Liability, FirstDeathTransfer } from "./types";
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
    via: FirstDeathTransfer["via"];
    recipientKind: FirstDeathTransfer["recipientKind"];
    recipientId: string | null;
    recipientLabel: string;
  };
};

export interface SplitAccountResult {
  resultingAccounts: Account[];
  resultingLiabilities: Liability[];
  ledgerEntries: Array<Omit<FirstDeathTransfer, "year" | "deceased">>;
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
        via: share.ledgerMeta.via,
        recipientKind: share.ledgerMeta.recipientKind,
        recipientId: share.ledgerMeta.recipientId,
        recipientLabel: share.ledgerMeta.recipientLabel,
        amount,
        basis: basisShare,
        resultingAccountId: null,
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
      via: share.ledgerMeta.via,
      recipientKind: share.ledgerMeta.recipientKind,
      recipientId: share.ledgerMeta.recipientId,
      recipientLabel: share.ledgerMeta.recipientLabel,
      amount,
      basis: basisShare,
      resultingAccountId: newAccount.id,
    });
  }

  return { resultingAccounts, resultingLiabilities, ledgerEntries };
}
