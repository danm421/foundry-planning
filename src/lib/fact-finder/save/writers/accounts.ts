// src/lib/fact-finder/save/writers/accounts.ts
/**
 * The save's account and business writers (Plan 4, D4). Each line goes through
 * the Details account write path on the save's transaction; then the writer
 * saves what that path doesn't: a new property's address (the create schema
 * drops it) and an account's positions — each one written in place or added,
 * never deleted, with the statement import's rule for when the account takes
 * its value from them. Tickers are priced before the transaction
 * (resolveSaveHoldings); the asset-mix roll-up waits for the commit.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { accountHoldings, accounts } from "@/db/schema";
import { createAccountForClient, updateAccountForClient } from "@/lib/clients/accounts-writes";
import type { ExtractedHolding } from "@/lib/extraction/types";
import { holdingRow, resolveTickers } from "@/lib/imports/commit/holdings";
import { accountHoldingsGuardrail } from "@/lib/imports/commit/holdings-guardrail";
import type { ResolvedHoldingsMap } from "@/lib/imports/commit/types";
import { syncAccountFromHoldings } from "@/lib/investments/sync-account-from-holdings";
import type { PlacedValue } from "../../change-set";
import { holdingKey } from "../../state";
import { unwrap, type PlannedLine, type SaveContext, type SaveWriter } from "../types";

type AccountRow = typeof accounts.$inferSelect;
type HoldingRow = typeof accountHoldings.$inferSelect;
type Position = Record<string, PlacedValue>;

/** Who writes, on the save's transaction, with its after-commit queue. */
function coreArgs(ctx: SaveContext) {
  return { clientId: ctx.clientId, firmId: ctx.firmId, actorId: ctx.actorId, tx: ctx.tx, afterCommit: ctx.afterCommit };
}

/** The positions a line lists, else null — the line says nothing about them. */
function positionsOf(values: Record<string, PlacedValue>): Position[] | null {
  return Array.isArray(values.holdings) ? (values.holdings as Position[]) : null;
}

const textOf = (v: PlacedValue | undefined) => (typeof v === "string" && v.trim() !== "" ? v : undefined);
const numberOf = (v: PlacedValue | undefined) => (typeof v === "number" ? v : undefined);

/** A fact finder position as a statement import's holding: a blank is no value. */
function toExtracted(p: Position): ExtractedHolding {
  return {
    ticker: textOf(p.ticker),
    name: textOf(p.name),
    shares: numberOf(p.shares),
    price: numberOf(p.price),
    marketValue: numberOf(p.marketValue),
    costBasis: numberOf(p.costBasis),
  };
}

/**
 * A position on record brought to the line's figures: shares, cost basis and
 * price — a classified ticker's live price and security, as the import prices
 * them — and its value only where the row stores one (a ticker without one is
 * worth shares × price). Every other column stays: notes, the price date when
 * there's no new price.
 */
function inPlace(row: HoldingRow, p: Position, resolved: ResolvedHoldingsMap) {
  const ticker = textOf(p.ticker)?.trim().toUpperCase();
  const r = ticker ? resolved.get(ticker) : undefined;
  const marketValue = numberOf(p.marketValue);
  return {
    shares: String(numberOf(p.shares) ?? 0),
    costBasis: String(numberOf(p.costBasis) ?? 0),
    price: String(r?.price ?? numberOf(p.price) ?? 0),
    ...(r ? { securityId: r.securityId } : {}),
    ...(r?.price != null ? { priceAsOf: r.asOf } : {}),
    ...(row.marketValue !== null && marketValue !== undefined ? { marketValue: String(marketValue) } : {}),
    updatedAt: new Date(),
  };
}

const keyOf = (h: HoldingRow) => holdingKey({ ticker: h.displayTicker, name: h.displayName });

/**
 * The line's positions, one by one — never a delete (Plan 4 ruling: a value
 * on record is never erased, and anything keyed by a position's id — its
 * asset-class overrides — must stay on it). Each pairs with the account's
 * position of the same ticker, else name (holdingKey — the review's merge
 * rule) and is updated in place; one the account doesn't have is added after
 * its others. The review never changes a position with neither ticker nor
 * name, so those on record stay as they are; a position the line doesn't
 * list is untouched.
 */
async function writePositions(ctx: SaveContext, accountId: string, positions: Position[]): Promise<void> {
  const onRecord = await ctx.tx
    .select()
    .from(accountHoldings)
    .where(eq(accountHoldings.accountId, accountId))
    .orderBy(asc(accountHoldings.sortOrder), asc(accountHoldings.id));
  const paired = new Set<string>();
  let unnamedOnRecord = onRecord.filter((h) => keyOf(h) === null).length;
  let sortOrder = Math.max(-1, ...onRecord.map((h) => h.sortOrder)) + 1;
  const added: ReturnType<typeof holdingRow>[] = [];
  for (const p of positions) {
    const holding = toExtracted(p);
    const key = holdingKey(holding);
    if (key === null && unnamedOnRecord > 0) {
      unnamedOnRecord -= 1;
      continue;
    }
    const row = key === null ? undefined : onRecord.find((h) => !paired.has(h.id) && keyOf(h) === key);
    if (!row) {
      added.push(holdingRow(accountId, holding, ctx.holdings, sortOrder++));
      continue;
    }
    paired.add(row.id);
    await ctx.tx.update(accountHoldings).set(inPlace(row, p, ctx.holdings)).where(eq(accountHoldings.id, row.id));
  }
  if (added.length > 0) await ctx.tx.insert(accountHoldings).values(added);
}

/**
 * An account's positions: the account derives its value from them unless they
 * fall well short of its stated value (then the value stays and its notes say
 * so — the statement import's rule, commit/accounts.ts), each position is
 * written (writePositions), and the asset-mix roll-up is queued. A position's
 * cost basis stays on the position, never the account's basis.
 */
async function saveHoldings(ctx: SaveContext, account: AccountRow, positions: Position[]): Promise<void> {
  const holdings = positions.map(toExtracted);
  const guard = accountHoldingsGuardrail({ value: Number(account.value), holdings });
  await ctx.tx
    .update(accounts)
    .set({
      deriveFromHoldings: guard.deriveFromHoldings,
      ...(guard.note ? { notes: sql`COALESCE(${accounts.notes} || E'\n', '') || ${guard.note}` } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(accounts.id, account.id), eq(accounts.clientId, ctx.clientId)));
  await writePositions(ctx, account.id, positions);
  ctx.afterCommit(() => syncAccountFromHoldings(account.id));
}

/** A business is an account (category business): the same write path; its lines carry no address or positions. */
const accountWriter: SaveWriter = {
  async create(ctx, { values, body }) {
    const { data } = unwrap(await createAccountForClient({ ...coreArgs(ctx), input: body }));
    if (typeof values.propertyAddress === "string") {
      await ctx.tx
        .update(accounts)
        .set({ propertyAddress: values.propertyAddress })
        .where(and(eq(accounts.id, data.id), eq(accounts.clientId, ctx.clientId)));
    }
    const positions = positionsOf(values);
    if (positions) await saveHoldings(ctx, data, positions);
    return data.id;
  },
  async update(ctx, { values, body, recordId }) {
    const { data } = unwrap(await updateAccountForClient({ ...coreArgs(ctx), accountId: recordId!, input: body }));
    const positions = positionsOf(values);
    if (positions) await saveHoldings(ctx, data, positions);
  },
};

export const ACCOUNT_WRITERS: { account: SaveWriter; business_account: SaveWriter } = {
  account: accountWriter,
  business_account: accountWriter,
};

/** Prices every ticker the planned account lines' holdings name — before the transaction (network). Never throws. */
export async function resolveSaveHoldings(planned: readonly PlannedLine[]): Promise<ResolvedHoldingsMap> {
  const tickers = new Set<string>();
  for (const { line, values } of planned) {
    if (line.target !== "account") continue;
    for (const p of positionsOf(values) ?? []) {
      const t = textOf(p.ticker)?.trim().toUpperCase();
      if (t) tickers.add(t);
    }
  }
  return resolveTickers([...tickers]);
}
