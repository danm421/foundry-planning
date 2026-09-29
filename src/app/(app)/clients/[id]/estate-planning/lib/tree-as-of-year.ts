import type { Account, ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine";
import { isPolicyInForce } from "@/lib/estate/insurance-in-force";
import { foldPartitionedAccount, isPartitionedAt } from "@/lib/estate/account-owner-slices";
import { ownersForYearOrHousehold } from "@/lib/estate/owners-or-household";

export type BalanceMode = "boy" | "eoy";

/**
 * Returns a copy of `tree` with each account's `value` and each liability's
 * `balance` overridden to the requested year's snapshot, sourced from the
 * projection. Keeps `rowsForFamilyMember` / `rowsForEntity` /
 * `unlinkedLiabilitiesForFamilyMember` (which read `account.value` and
 * `liability.balance` directly) consistent with the spine's net-worth values
 * at the same year.
 *
 * Each account's owners are the year's too: the authored rows with every
 * lifetime gift through `year` composed on top, so a gifted trust or person
 * gets its own row. Such an account carries `giftsReflectedThrough: year`, for
 * a gift-aware DIRECT caller handed these rows beside the raw events. Gifts
 * that cannot be composed (an overdraw) leave the authored rows and no marker.
 * The spine's gross estate is not that caller: it deliberately takes the
 * authored rows and drops the marker for every account a death did not
 * partition (`computeGrossEstateAtYear`, T24-g).
 *
 * `mode` mirrors the Balance Sheet's two views:
 *   - "boy" (Today) — beginning-of-year balances. At planStartYear these
 *     equal the advisor-entered values, so the original tree is returned
 *     unchanged (authored owners: a gift dated in the plan's first year has
 *     not happened yet).
 *   - "eoy" (default) — end-of-year balances for the requested year.
 *
 * "Today · 2026" and "End of 2026" land on the same calendar year but
 * resolve to different snapshots (BoY vs EoY). Callers must pass the
 * intended mode rather than relying on `year` alone.
 *
 * Falls back to the original tree if the requested year isn't in the
 * projection (e.g., past planEndYear).
 */
export function treeAsOfYear(
  tree: ClientData,
  withResult: ProjectionResult,
  year: number,
  mode: BalanceMode = "eoy",
): ClientData {
  const planStartYear = tree.planSettings.planStartYear;
  if (mode === "boy" && year === planStartYear) {
    return overlayLifeInsuranceFaceValue(tree, year);
  }

  const yearRow = withResult.years.find((y) => y.year === year);
  if (!yearRow) return overlayLifeInsuranceFaceValue(tree, year);

  const accounts = tree.accounts.map((a) => {
    if (mode === "eoy" && isPartitionedAt(yearRow, a.id)) return partitionedAsOf(a, yearRow);
    const ledger = yearRow.accountLedgers[a.id];
    if (!ledger) return { ...a, value: 0 };
    const value = mode === "boy" ? ledger.beginningValue : ledger.endingValue;
    // The year's owners: the authored rows with every gift through `year`
    // composed on top — which ADDS the recipient's row (a trust's `entity`, a
    // person's `gifted_away`). The marker tells a gift-aware direct caller
    // handed these rows alongside the raw events not to apply those gifts a
    // second time, so it is stamped only when composition succeeded.
    let composed: Account["owners"];
    let marker: { giftsReflectedThrough?: number } = { giftsReflectedThrough: year };
    try {
      composed = ownersForYearOrHousehold(a, tree.giftEvents ?? [], year, planStartYear);
    } catch {
      composed = a.owners; // overdrawn gifts: authored rows reflect none of them
      marker = {};
    }
    if (mode !== "eoy" || composed.length <= 1 || value <= 0) {
      return { ...a, value, owners: composed, ...marker };
    }

    // EoY multi-owner accounts: renormalize percents from the engine's locked
    // shares so household withdrawals don't bleed into the entity's slice
    // (and vice versa). Mirrors balance-sheet/view-model.ts. Consumers that
    // do `account.value × owner.percent` (render-rows.ts:82) then yield the
    // same locked slice the balance sheet shows.
    let totalEntityShare = 0;
    let familyPercentTotal = 0;
    let giftedAwayPercentTotal = 0;
    for (const o of composed) {
      if (o.kind === "entity") {
        const locked = yearRow.entityAccountSharesEoY?.get(o.entityId)?.get(a.id);
        totalEntityShare += locked ?? value * o.percent;
      } else if (o.kind === "gifted_away") {
        giftedAwayPercentTotal += o.percent;
      } else {
        familyPercentTotal += o.percent;
      }
    }
    const familyPoolPreGift = Math.max(0, value - totalEntityShare);
    const familyPool = Math.max(0, familyPoolPreGift - value * giftedAwayPercentTotal);
    // Locked family shares are gift-blind toward a gift to a person: they split
    // a pool that still holds the gifted slice. Scale them onto the post-gift
    // pool, as `resolveOwnerSlices` does (factor 1 with no such gift).
    const lockedFmFactor = familyPoolPreGift > 0 ? familyPool / familyPoolPreGift : 1;

    const owners = composed.map((o) => {
      let sliceValue: number;
      if (o.kind === "entity") {
        const locked = yearRow.entityAccountSharesEoY?.get(o.entityId)?.get(a.id);
        sliceValue = locked ?? value * o.percent;
      } else if (o.kind === "family_member") {
        const lockedFm = yearRow.familyAccountSharesEoY
          ?.get(o.familyMemberId)
          ?.get(a.id);
        if (lockedFm != null) {
          sliceValue = lockedFm * lockedFmFactor;
        } else {
          sliceValue =
            familyPercentTotal > 0
              ? familyPool * (o.percent / familyPercentTotal)
              : value * o.percent;
        }
      } else {
        // gifted_away holds its own `value × percent`; external_beneficiary has
        // no locked share semantics — both pro-rate by percent.
        sliceValue = value * o.percent;
      }
      return { ...o, percent: sliceValue / value };
    });

    return { ...a, value, owners, ...marker };
  });

  const liabilities = (tree.liabilities ?? []).map((l) => {
    if (mode === "boy") {
      const boy = yearRow.liabilityBalancesBoY?.[l.id];
      return boy != null ? { ...l, balance: boy } : l;
    }
    // EoY of year Y = BoY of Y+1 (amortization is continuous between years).
    // Past plan end, fall back to Y's BoY.
    const nextYearRow = withResult.years.find((y) => y.year === year + 1);
    const eoy = nextYearRow?.liabilityBalancesBoY?.[l.id];
    if (eoy != null) return { ...l, balance: eoy };
    const sameYearBoY = yearRow.liabilityBalancesBoY?.[l.id];
    return sameYearBoY != null ? { ...l, balance: sameYearBoY } : l;
  });

  return overlayLifeInsuranceFaceValue({ ...tree, accounts, liabilities }, year);
}

type YearRow = ProjectionResult["years"][number];

/** EoY view of a partitioned account: the pool plus every account carved out
 *  of it, as ONE account whose rows are each owner's share of that whole. The
 *  authored rows describe none of it — after the death the pool is the
 *  survivor's and the entity's share is its own slice. The rows written here
 *  already reflect every gift through `year`, so the account says so
 *  (`giftsReflectedThrough`): a gift-aware reader downstream (the spine's
 *  gross estate) must not apply those gifts to them again. */
function partitionedAsOf(a: Account, yearRow: YearRow): Account {
  const folded = foldPartitionedAccount({
    account: a,
    yearRow,
    valueOf: (id) => yearRow.accountLedgers[id]?.endingValue ?? 0,
    fallbackOwners: () => a.owners,
  });
  if (folded.value <= 0) return { ...a, value: 0 };
  return { ...a, value: folded.value, owners: folded.owners, giftsReflectedThrough: yearRow.year };
}

/** For every in-force life-insurance policy, swap the account's cash-surrender
 *  value for its face value. Mirrors `prepareLifeInsurancePayouts` in the
 *  engine so the canvas's IN ESTATE / OUT OF ESTATE columns and the spine's
 *  per-principal net worth reflect the death benefit — which is what shows up
 *  in the gross estate on the Estate Tax report. */
function overlayLifeInsuranceFaceValue(tree: ClientData, year: number): ClientData {
  const clientRetirementYear = retirementYearFor(
    tree.client.dateOfBirth,
    tree.client.retirementAge,
  );
  const spouseRetirementYear = retirementYearFor(
    tree.client.spouseDob,
    tree.client.spouseRetirementAge,
  );

  let touched = false;
  const accounts = tree.accounts.map((a) => {
    if (a.category !== "life_insurance" || !a.lifeInsurance) return a;
    const insuredRetirementYear = resolveInsuredRetirementYear(
      a,
      clientRetirementYear,
      spouseRetirementYear,
    );
    if (!isPolicyInForce(a, year, insuredRetirementYear)) return a;
    touched = true;
    return { ...a, value: a.lifeInsurance.faceValue };
  });
  return touched ? { ...tree, accounts } : tree;
}

function retirementYearFor(
  dob: string | null | undefined,
  retirementAge: number | null | undefined,
): number | null {
  if (!dob || retirementAge == null) return null;
  const birthYear = parseInt(dob.slice(0, 4), 10);
  return Number.isFinite(birthYear) ? birthYear + retirementAge : null;
}

function resolveInsuredRetirementYear(
  account: Account,
  clientRetirementYear: number | null,
  spouseRetirementYear: number | null,
): number | null {
  switch (account.insuredPerson) {
    case "client":
      return clientRetirementYear;
    case "spouse":
      return spouseRetirementYear;
    case "joint":
      if (clientRetirementYear == null) return spouseRetirementYear;
      if (spouseRetirementYear == null) return clientRetirementYear;
      return Math.max(clientRetirementYear, spouseRetirementYear);
    default:
      return null;
  }
}