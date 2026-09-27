// src/engine/family-cashflow.ts
//
// Per-family-member locked-share ledger for jointly-held accounts. Mirrors
// the entity locked-share pattern in entity-cashflow.ts but for family↔family
// splits. Emits ProjectionYear.familyAccountSharesEoY so the balance sheet
// can render projected (drifted) ownership percentages instead of the static
// authored split.
//
// Drift drivers (per spec):
//   - Attributed income deposits → credit the income's owner share.
//   - Cash gifts (kind: "cash") → debit the grantor's share first, then
//     pull pro-rata from co-owners if grantor is exhausted.
//   - Asset gifts (kind: "asset") → the same grantor-first debit, at BoY, of
//     percent × the account's beginning value.
//   - Death event → at next BoY, surviving owners absorb deceased's share
//     pro-rata to their pre-death shares.
//
// Everything else (passive growth, withdrawals, expenses, taxes, transfers,
// untagged deposits) moves pro-rata to current shares — preserves drift but
// doesn't drive it.

import type { ProjectionYear, Income, GiftEvent, FamilyMember } from "./types";

export interface ComputeFamilyAccountSharesInput {
  years: ProjectionYear[];
  /** Account → family-member owners, resolved AT A GIVEN YEAR. Was a
   *  year-invariant Map built from authored owners, so a gift that moved a
   *  share out of the household never showed up in the ledger. Only accounts
   *  with ≥2 family owners in some year need a per-member ledger. */
  accountFamilyOwnersAt: (
    accountId: string,
    year: number,
  ) => Array<{ familyMemberId: string; percent: number }>;
  /** Candidate account ids — the resolver cannot be enumerated. */
  candidateAccountIds: string[];
  /** The plan's first year. An asset gift dated before it is already in the
   *  authored owners, so it must not debit anyone again. */
  planStartYear: number;
  /** Resolves "client" → familyMemberId for the household principal. */
  clientFamilyMemberId: string | null;
  /** Resolves "spouse" → familyMemberId. Null in single-filer plans. */
  spouseFamilyMemberId: string | null;
  /** Resolved incomes (same array runProjection built). Used to map
   *  income-category ledger entries back to their owner. */
  incomes: Income[];
  /** Resolved gift events (post-fanout). Cash gifts attribute to grantor. */
  gifts: GiftEvent[];
  /** Family-member metadata. Currently unused but reserved for richer
   *  death-event handling (e.g., resolving deceased name for warnings). */
  familyMembers: FamilyMember[];
}

/** Mutates input.years[].familyAccountSharesEoY in place. */
export function computeFamilyAccountShares(input: ComputeFamilyAccountSharesInput): void {
  const {
    years,
    accountFamilyOwnersAt,
    candidateAccountIds,
    planStartYear,
    incomes,
    gifts,
    clientFamilyMemberId,
    spouseFamilyMemberId,
  } = input;
  // Accounts that need a per-member ledger in ANY year (≥2 family owners).
  // Unioned across years for the same reason as entity-cashflow: ownership is
  // a step function of year, so an account's owner set can change mid-horizon.
  const ledgerAccountIds = candidateAccountIds.filter((accountId) =>
    years.some((y) => accountFamilyOwnersAt(accountId, y.year).length >= 2),
  );
  if (ledgerAccountIds.length === 0) return;

  const incomeOwnerById = new Map<string, "client" | "spouse" | "joint">();
  for (const inc of incomes) incomeOwnerById.set(inc.id, inc.owner);

  // Index cash gifts by (sourceAccountId, year) so per-year attribution can
  // sum amounts by grantor without re-scanning the full gift list. Engine
  // writes ledger entries with sourceId = recipientEntityId, not the gift
  // event id, so we can't join on entry.sourceId — keying by (account, year)
  // instead.
  const cashGiftsByAccountYear = new Map<string, Array<{ grantor: "client" | "spouse" | "joint"; amount: number }>>();
  const giftKey = (accountId: string, year: number) => `${accountId}|${year}`;
  for (const g of gifts) {
    if (g.kind !== "cash") continue;
    if (!g.sourceAccountId) continue;
    const k = giftKey(g.sourceAccountId, g.year);
    const list = cashGiftsByAccountYear.get(k) ?? [];
    list.push({ grantor: g.grantor, amount: g.amount });
    cashGiftsByAccountYear.set(k, list);
  }

  // Asset gifts by (account, year). These move OWNERSHIP, not cash: the
  // account's balance is unchanged and the grantor's share of it shrinks.
  // `gifts` used to be filtered to kind === "cash" and nothing else, so an
  // asset gift moved no family share at all.
  //
  // The window mirrors buildOwnershipSnapshot's, so the debit lands in exactly
  // the year the resolver's owners change: a gift before planStartYear is
  // already in the authored owners (skip it), and one before the first
  // projected year takes effect in that first year.
  const firstYear = years[0]?.year ?? planStartYear;
  const assetGiftsByAccountYear = new Map<string, Array<{ grantor: "client" | "spouse"; percent: number }>>();
  for (const g of gifts) {
    if (g.kind !== "asset") continue;
    if (g.year < planStartYear) continue;
    const k = giftKey(g.accountId, Math.max(g.year, firstYear));
    const list = assetGiftsByAccountYear.get(k) ?? [];
    list.push({ grantor: g.grantor, percent: g.percent });
    assetGiftsByAccountYear.set(k, list);
  }

  // Resolve "client" | "spouse" → familyMemberId. Returns null if the role
  // isn't present in the household (single-filer plans have no spouseFmId)
  // or if the input is "joint" (caller falls back to pro-rata).
  const resolveOwnerToFm = (owner: "client" | "spouse" | "joint"): string | null => {
    if (owner === "client") return clientFamilyMemberId;
    if (owner === "spouse") return spouseFamilyMemberId;
    return null;
  };

  // Per-member per-account locked EoY share, carried year-to-year.
  const lockedShareByMemberAccount = new Map<string, Map<string, number>>();
  const setLocked = (fmId: string, aid: string, value: number) => {
    if (!lockedShareByMemberAccount.has(fmId)) lockedShareByMemberAccount.set(fmId, new Map());
    lockedShareByMemberAccount.get(fmId)!.set(aid, value);
  };
  const getLocked = (fmId: string, aid: string) =>
    lockedShareByMemberAccount.get(fmId)?.get(aid);

  // Sum of entity-locked shares on this account in this year (mixed-ownership
  // case). Family shares track within the family pool = ledger.endingValue − this.
  const entityLockedTotalForAccount = (year: ProjectionYear, accountId: string): number => {
    const map = year.entityAccountSharesEoY;
    if (!map) return 0;
    let sum = 0;
    for (const accMap of map.values()) sum += accMap.get(accountId) ?? 0;
    return sum;
  };

  for (let yearIdx = 0; yearIdx < years.length; yearIdx++) {
    const year = years[yearIdx];

    // Death absorption: at the start of each year, redistribute any locked
    // shares owned by family members who died in the prior year. Surviving
    // co-owners absorb the deceased's share pro-rata to their carried shares.
    // (deathTransfers carries `deceased: "client" | "spouse"` per types.ts:73.)
    const prior = yearIdx > 0 ? years[yearIdx - 1] : undefined;
    const priorDeathRoles = new Set<"client" | "spouse">();
    for (const dt of prior?.deathTransfers ?? []) priorDeathRoles.add(dt.deceased);
    if (priorDeathRoles.size > 0) {
      const priorDeathFmIds = new Set<string>();
      for (const role of priorDeathRoles) {
        const fmId = resolveOwnerToFm(role);
        if (fmId) priorDeathFmIds.add(fmId);
      }
      for (const accountId of ledgerAccountIds) {
        const owners = accountFamilyOwnersAt(accountId, year.year);
        let totalDeceased = 0;
        for (const fmId of priorDeathFmIds) {
          const v = getLocked(fmId, accountId);
          if (v != null) {
            if (v > 0) totalDeceased += v;
            setLocked(fmId, accountId, 0);
          }
        }
        if (totalDeceased <= 0) continue;
        const survivors = owners.filter((o) => !priorDeathFmIds.has(o.familyMemberId));
        const survivorTotal = survivors.reduce(
          (s, o) => s + (getLocked(o.familyMemberId, accountId) ?? 0),
          0,
        );
        if (survivorTotal <= 0) {
          if (survivors.length > 0) {
            const split = totalDeceased / survivors.length;
            for (const o of survivors) setLocked(o.familyMemberId, accountId, split);
          }
        } else {
          for (const o of survivors) {
            const cur = getLocked(o.familyMemberId, accountId) ?? 0;
            setLocked(o.familyMemberId, accountId, cur + totalDeceased * (cur / survivorTotal));
          }
        }
      }
    }

    for (const accountId of ledgerAccountIds) {
      const ledger = year.accountLedgers[accountId];
      if (!ledger) continue;
      const owners = accountFamilyOwnersAt(accountId, year.year);
      const ownerFmIds = new Set(owners.map((o) => o.familyMemberId));
      const assetGiftsThisYear = assetGiftsByAccountYear.get(giftKey(accountId, year.year)) ?? [];

      // BoY shares: carried from prior year, or seeded at beginningValue ×
      // percent on year 0 — each owner's slice of the WHOLE account, so a mixed
      // account (70% trust + 15%/15% family) seeds 15k each on a $100k account.
      // The seed reads the owners in force BEFORE this year's gifts (the
      // resolver's prior year): this year's asset gifts are debited below, and
      // a seed from the post-gift owners would take them a second time.
      const familyPercentTotal = owners.reduce((s, o) => s + o.percent, 0);
      const familyPoolBoY = ledger.beginningValue * familyPercentTotal;
      const preGiftPercent =
        assetGiftsThisYear.length > 0
          ? new Map(
              accountFamilyOwnersAt(accountId, year.year - 1).map((o) => [o.familyMemberId, o.percent]),
            )
          : undefined;
      const shares: Record<string, number> = {};
      for (const o of owners) {
        const carried = getLocked(o.familyMemberId, accountId);
        const seedPercent = preGiftPercent?.get(o.familyMemberId) ?? o.percent;
        shares[o.familyMemberId] = carried ?? ledger.beginningValue * seedPercent;
      }

      const sumShares = () => owners.reduce((s, o) => s + shares[o.familyMemberId], 0);
      const distributeProRata = (amount: number) => {
        const total = sumShares();
        if (total <= 0) return;
        for (const o of owners) {
          shares[o.familyMemberId] += amount * (shares[o.familyMemberId] / total);
        }
      };

      // Take `amount` out of the grantor's share first; if that runs dry, pull
      // the remainder pro-rata from the co-owners. A grantor not on this
      // account pays nothing directly — the whole amount goes pro-rata.
      const drawFromGrantor = (grantor: "client" | "spouse" | "joint", amount: number) => {
        const grantorFmId = resolveOwnerToFm(grantor);
        if (!grantorFmId || !ownerFmIds.has(grantorFmId)) {
          distributeProRata(-amount);
          return;
        }
        const fromGrantor = Math.min(amount, Math.max(0, shares[grantorFmId]));
        shares[grantorFmId] -= fromGrantor;
        const remainder = amount - fromGrantor;
        if (remainder <= 0) return;
        const coOwners = owners.filter((o) => o.familyMemberId !== grantorFmId);
        const coTotal = coOwners.reduce((s, o) => s + Math.max(0, shares[o.familyMemberId]), 0);
        if (coTotal <= 0) return;
        for (const o of coOwners) {
          shares[o.familyMemberId] -= remainder * (Math.max(0, shares[o.familyMemberId]) / coTotal);
        }
      };

      // Asset gifts land at BoY, valued at percent × the whole account's BoY —
      // the same valuation the recipient trust's locked share is topped up by
      // (locked-shares.ts), so the family debit and the entity credit match to
      // the dollar. Nobody in the family is credited: a gift to a person is a
      // `gifted_away` owner row, which the balance sheet values and subtracts
      // from the family pool itself (account-owner-slices.ts).
      for (const g of assetGiftsThisYear) {
        drawFromGrantor(g.grantor, g.percent * ledger.beginningValue);
      }

      // Passive growth: distribute the family pool's share of growth pro-rata.
      // For non-mixed accounts (no entity owners) this equals ledger.growth.
      const familyGrowth =
        ledger.beginningValue > 0
          ? ledger.growth * (familyPoolBoY / ledger.beginningValue)
          : 0;
      if (familyGrowth) distributeProRata(familyGrowth);

      // Walk attributable entries. Income deposits with a known owner credit
      // that owner's share; everything else flows pro-rata. Skip internal
      // transfers, growth (already applied), and gift entries (handled below
      // via the (account, year) gift index so we can resolve grantor).
      for (const entry of ledger.entries ?? []) {
        if (entry.isInternalTransfer) continue;
        if (entry.category === "growth") continue;
        if (entry.category === "gift") continue;

        const isIncomeDeposit =
          entry.category === "income" && entry.amount > 0 && entry.sourceId;
        if (isIncomeDeposit) {
          const owner = incomeOwnerById.get(entry.sourceId!);
          const fmId = owner ? resolveOwnerToFm(owner) : null;
          if (fmId && ownerFmIds.has(fmId)) {
            shares[fmId] += entry.amount;
            continue;
          }
          // Owner unresolvable or not on this account → fall through to pro-rata.
        }

        distributeProRata(entry.amount);
      }

      // Apply cash gifts targeting this account this year. Draw from grantor's
      // share first; if exhausted, pull remainder pro-rata from co-owners.
      const giftsThisYear = cashGiftsByAccountYear.get(giftKey(accountId, year.year)) ?? [];
      for (const g of giftsThisYear) drawFromGrantor(g.grantor, g.amount);

      // Settle: scale shares so they sum to the actual family-pool EoY. This
      // reconciles any rounding drift from the per-entry walk, and (more
      // importantly) collapses overdrafts by clamping negatives to 0 first
      // before normalizing. Mixed-ownership accounts: pool = ledger.endingValue
      // − Σ entity-locked shares for this account.
      const familyPoolEoY = Math.max(0, ledger.endingValue - entityLockedTotalForAccount(year, accountId));
      let positiveSum = 0;
      for (const o of owners) {
        if (shares[o.familyMemberId] < 0) shares[o.familyMemberId] = 0;
        positiveSum += shares[o.familyMemberId];
      }
      if (familyPoolEoY > 0 && positiveSum > 0) {
        const scale = familyPoolEoY / positiveSum;
        for (const o of owners) shares[o.familyMemberId] *= scale;
      } else if (familyPoolEoY <= 0) {
        for (const o of owners) shares[o.familyMemberId] = 0;
      }

      // Publish.
      if (!year.familyAccountSharesEoY) year.familyAccountSharesEoY = new Map();
      for (const o of owners) {
        const v = shares[o.familyMemberId];
        setLocked(o.familyMemberId, accountId, v);
        if (!year.familyAccountSharesEoY.has(o.familyMemberId)) {
          year.familyAccountSharesEoY.set(o.familyMemberId, new Map());
        }
        year.familyAccountSharesEoY.get(o.familyMemberId)!.set(accountId, v);
      }
    }
  }
}
