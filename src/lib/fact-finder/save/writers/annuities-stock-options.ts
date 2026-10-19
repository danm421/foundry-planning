// src/lib/fact-finder/save/writers/annuities-stock-options.ts
/**
 * Save writers for an annuity's contract and for stock options (Plan 4, D4).
 * The contract PUT and the grant PUT each replace their whole record, so the
 * writer sends the record on file merged under the line's keys — a blank in
 * the fact finder never erases a value. A grant's vest rows merge by vest
 * date: a listed date takes the line's shares and keeps the rest of its row
 * (what was exercised or sold, when, at what price), a new date is added, and
 * a row the line doesn't list stays. The grant's planned events are never
 * sent, so the PUT keeps them.
 */
import { and, asc, eq } from "drizzle-orm";
import { accounts, annuityContracts, stockOptionGrants, stockOptionVestTranches } from "@/db/schema";
import { serializeContract, upsertAnnuityContractForClient } from "@/lib/clients/annuity-contracts-writes";
import {
  createStockOptionAccountForClient,
  createStockOptionGrantForClient,
  updateStockOptionAccountForClient,
  updateStockOptionGrantForClient,
} from "@/lib/clients/stock-options-writes";
import { coreArgs, SaveLineError, unwrap, type SaveContext, type SaveWriter } from "../types";

type Body = Record<string, unknown>;
type Tranche = { vestDate: string; shares: number } & Body;
/** A grant on record in the shape its PUT takes (no planned events). */
type GrantOnRecord = Body & { tranches: Tranche[] };

/** The record or parent a line names, or a SaveLineError (a 422 naming the line). */
function idOf(id: string | null, what: string): string {
  if (!id) throw new SaveLineError(`This line names no ${what}.`);
  return id;
}

const num = (v: string | null): number | null => (v == null ? null : Number(v));

/** The contract an account has on record (scoped by client), as its PUT body; none → {}. */
async function contractOnRecord(ctx: SaveContext, accountId: string): Promise<Body> {
  const [row] = await ctx.tx
    .select({ contract: annuityContracts })
    .from(annuityContracts)
    .innerJoin(accounts, eq(accounts.id, annuityContracts.accountId))
    .where(and(eq(annuityContracts.accountId, accountId), eq(accounts.clientId, ctx.clientId)));
  return row ? serializeContract(row.contract) : {};
}

/** Both a Create and an Update upsert the contract keyed by its account; returns that account's id. */
async function upsertContract(ctx: SaveContext, accountId: string, body: Body): Promise<string> {
  const input = { ...(await contractOnRecord(ctx, accountId)), ...body };
  unwrap(await upsertAnnuityContractForClient({ ...coreArgs(ctx), accountId, input }));
  return accountId;
}

/**
 * An annuity account's contract brought in step with it — the Details form's
 * second write when it saves an annuity account: the contract on record (else
 * the schema's defaults) upserted, audited, the core taking the tax treatment
 * from the account's sub-type. The account writer calls it; a contract line
 * later in the save upserts over it.
 */
export async function syncContractToAccount(ctx: SaveContext, accountId: string): Promise<void> {
  await upsertContract(ctx, accountId, {});
}

/** A grant on record (scoped by account and client), its vest rows in their order; null when it isn't there. */
async function grantOnRecord(ctx: SaveContext, accountId: string, grantId: string): Promise<GrantOnRecord | null> {
  const [row] = await ctx.tx
    .select({ grant: stockOptionGrants })
    .from(stockOptionGrants)
    .innerJoin(accounts, eq(accounts.id, stockOptionGrants.accountId))
    .where(and(eq(stockOptionGrants.id, grantId), eq(stockOptionGrants.accountId, accountId), eq(accounts.clientId, ctx.clientId)));
  if (!row) return null;
  const g = row.grant;
  const tranches = await ctx.tx
    .select()
    .from(stockOptionVestTranches)
    .where(eq(stockOptionVestTranches.grantId, grantId))
    .orderBy(asc(stockOptionVestTranches.sortOrder), asc(stockOptionVestTranches.vestDate));
  return {
    grantNumber: g.grantNumber,
    grantType: g.grantType,
    grantDate: g.grantDate,
    sharesGranted: Number(g.sharesGranted),
    has83bElection: g.has83bElection,
    fmvAtGrant: num(g.fmvAtGrant),
    strikePrice: num(g.strikePrice),
    strikeDiscountPct: num(g.strikeDiscountPct),
    expirationDate: g.expirationDate,
    exerciseTiming: g.exerciseTiming,
    exerciseYear: g.exerciseYear,
    sellTiming: g.sellTiming,
    sellYear: g.sellYear,
    sellPercentPerYear: num(g.sellPercentPerYear),
    sellStartYear: g.sellStartYear,
    notes: g.notes,
    tranches: tranches.map((t) => ({
      vestDate: t.vestDate,
      shares: Number(t.shares),
      sharesExercised: Number(t.sharesExercised),
      sharesSold: Number(t.sharesSold),
      acquiredOn: t.acquiredOn,
      priceAtAcquisition: num(t.priceAtAcquisition),
      exerciseTiming: t.exerciseTiming,
      exerciseYear: t.exerciseYear,
      sellTiming: t.sellTiming,
      sellYear: t.sellYear,
      sellPercentPerYear: num(t.sellPercentPerYear),
      sellStartYear: t.sellStartYear,
    })),
  };
}

/** The line's keys over the grant on record; vest rows merged by vest date and kept in date order. Pure. */
function mergeGrantBody(record: GrantOnRecord, body: Body): Body {
  if (!Array.isArray(body.tranches)) return { ...record, ...body };
  const listed = new Map((body.tranches as Tranche[]).map((t) => [t.vestDate, t]));
  const kept = record.tranches.map((t) => {
    const next = listed.get(t.vestDate);
    if (!next) return t;
    listed.delete(t.vestDate);
    return { ...t, shares: next.shares };
  });
  const tranches = [...kept, ...listed.values()].sort((a, b) => a.vestDate.localeCompare(b.vestDate));
  return { ...record, ...body, tranches };
}

export const ANNUITY_STOCK_WRITERS: { annuity_contract: SaveWriter; stock_option_account: SaveWriter; stock_option_grant: SaveWriter } = {
  // The contract's record is its account (the parent): an Update's recordId, a Create's parent.
  annuity_contract: {
    create: async (ctx, input) => upsertContract(ctx, idOf(input.parentId, "annuity account"), input.body),
    async update(ctx, input) {
      await upsertContract(ctx, idOf(input.recordId, "annuity account"), input.body);
    },
  },
  stock_option_account: {
    async create(ctx, input) {
      return unwrap(await createStockOptionAccountForClient({ ...coreArgs(ctx), input: input.body })).resourceId;
    },
    async update(ctx, input) {
      unwrap(await updateStockOptionAccountForClient({ ...coreArgs(ctx), accountId: idOf(input.recordId, "account"), input: input.body }));
    },
  },
  stock_option_grant: {
    async create(ctx, input) {
      const accountId = idOf(input.parentId, "stock option account");
      return unwrap(await createStockOptionGrantForClient({ ...coreArgs(ctx), accountId, input: input.body })).resourceId;
    },
    async update(ctx, input) {
      const accountId = idOf(input.parentId, "stock option account");
      const grantId = idOf(input.recordId, "grant");
      const record = await grantOnRecord(ctx, accountId, grantId);
      // No grant on record: the core refuses it ("Grant not found").
      const body = record ? mergeGrantBody(record, input.body) : input.body;
      unwrap(await updateStockOptionGrantForClient({ ...coreArgs(ctx), accountId, grantId, input: body }));
    },
  },
};
