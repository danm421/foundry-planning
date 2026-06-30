import type { Account, AssetTransaction, GiftEvent, Income } from "./types";
import { ownersForYear, type AccountOwner } from "./ownership";

export interface LinkedIncomeContext {
  accountById: Map<string, Account>;
  giftEvents: GiftEvent[];
  assetTransactions: AssetTransaction[];
  planStartYear: number;
  clientFmId: string | null;
  spouseFmId: string | null;
}

/** Fraction of the asset still owned (not yet sold) as of `year`. A full sale
 *  (fractionSold null or >= 1) drops it to 0; sequential partial sales compound. */
export function survivingSaleFraction(
  transactions: AssetTransaction[],
  accountId: string,
  year: number,
): number {
  let surviving = 1;
  const sales = transactions
    .filter(
      (t) =>
        (t.enabled ?? true) &&
        t.type === "sell" &&
        t.accountId === accountId &&
        t.year <= year,
    )
    .sort((a, b) => a.year - b.year);
  for (const s of sales) {
    const f = s.fractionSold;
    if (f == null || f >= 1) return 0;
    surviving *= 1 - f;
  }
  return surviving;
}

/** Map a year's household family_member owners to the income owner enum.
 *  Mirrors resolveOwner in lib/insurance-policies/load-li-inventory.ts. */
function householdOwnerEnum(
  owners: AccountOwner[],
  clientFmId: string | null,
  spouseFmId: string | null,
): "client" | "spouse" | "joint" {
  const fmIds = owners
    .filter((o): o is Extract<AccountOwner, { kind: "family_member" }> => o.kind === "family_member")
    .map((o) => o.familyMemberId);
  const hasClient = clientFmId != null && fmIds.includes(clientFmId);
  const hasSpouse = spouseFmId != null && fmIds.includes(spouseFmId);
  if (hasClient && hasSpouse) return "joint";
  if (hasSpouse) return "spouse";
  return "client";
}

/** Expand one linked "other" income into per-ownership-era owner slices. */
export function expandLinkedIncome(income: Income, ctx: LinkedIncomeContext): Income[] {
  const property = income.linkedPropertyId ? ctx.accountById.get(income.linkedPropertyId) : undefined;
  if (!property) return [income]; // unlinked or dangling → unchanged

  // Years where ownership or surviving-fraction changes, inside the income window.
  const boundaries = new Set<number>();
  for (const e of ctx.giftEvents) {
    if (e.kind === "asset" && e.accountId === property.id && e.year > income.startYear && e.year <= income.endYear) {
      boundaries.add(e.year);
    }
  }
  for (const t of ctx.assetTransactions) {
    if ((t.enabled ?? true) && t.type === "sell" && t.accountId === property.id && t.year > income.startYear && t.year <= income.endYear) {
      boundaries.add(t.year);
    }
  }
  const cuts = [...boundaries].sort((a, b) => a - b);

  const eras: Array<{ start: number; end: number }> = [];
  let cursor = income.startYear;
  for (const c of cuts) {
    eras.push({ start: cursor, end: c - 1 });
    cursor = c;
  }
  eras.push({ start: cursor, end: income.endYear });

  const scaleOverrides = (factor: number, start: number, end: number): Record<number, number> | undefined => {
    if (!income.scheduleOverrides) return undefined;
    const out: Record<number, number> = {};
    for (const [yr, amt] of Object.entries(income.scheduleOverrides)) {
      const y = Number(yr);
      if (y >= start && y <= end) out[y] = amt * factor;
    }
    return out;
  };

  const slices: Income[] = [];
  for (const era of eras) {
    if (era.end < era.start) continue;
    const surviving = survivingSaleFraction(ctx.assetTransactions, property.id, era.start);
    if (surviving <= 1e-9) continue;
    const owners = ownersForYear(property, ctx.giftEvents, era.start, ctx.planStartYear);

    const householdShare = owners
      .filter((o) => o.kind === "family_member")
      .reduce((s, o) => s + o.percent, 0);
    const entityShares = new Map<string, number>();
    for (const o of owners) {
      if (o.kind === "entity") entityShares.set(o.entityId, (entityShares.get(o.entityId) ?? 0) + o.percent);
    }
    // gifted_away / external_beneficiary shares are intentionally dropped.

    if (householdShare > 1e-9) {
      const factor = surviving * householdShare;
      slices.push({
        ...income,
        id: `${income.id}::era${era.start}::hh`,
        owner: householdOwnerEnum(owners, ctx.clientFmId, ctx.spouseFmId),
        ownerEntityId: undefined,
        ownerAccountId: undefined,
        cashAccountId: undefined,
        linkedPropertyId: undefined,
        annualAmount: income.annualAmount * factor,
        startYear: era.start,
        endYear: era.end,
        scheduleOverrides: scaleOverrides(factor, era.start, era.end),
      });
    }
    for (const [entityId, share] of entityShares) {
      const factor = surviving * share;
      slices.push({
        ...income,
        id: `${income.id}::era${era.start}::ent_${entityId}`,
        owner: "client", // irrelevant once ownerEntityId is set
        ownerEntityId: entityId,
        ownerAccountId: undefined,
        cashAccountId: undefined,
        linkedPropertyId: undefined,
        annualAmount: income.annualAmount * factor,
        startYear: era.start,
        endYear: era.end,
        scheduleOverrides: scaleOverrides(factor, era.start, era.end),
      });
    }
  }
  return slices;
}

/** Expand linked "other" incomes; pass every other income through unchanged. */
export function expandLinkedIncomes(incomes: Income[], ctx: LinkedIncomeContext): Income[] {
  return incomes.flatMap((inc) =>
    inc.type === "other" && inc.linkedPropertyId ? expandLinkedIncome(inc, ctx) : [inc],
  );
}
