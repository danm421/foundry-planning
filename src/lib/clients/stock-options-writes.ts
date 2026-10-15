// src/lib/clients/stock-options-writes.ts
/**
 * The stock option write paths, moved verbatim from their routes (Plan 4, D3)
 * so the fact finder save can run them on its transaction:
 *   POST /stock-option-accounts                       → createStockOptionAccountForClient
 *   PUT  /stock-option-accounts/[accountId]           → updateStockOptionAccountForClient
 *   POST /stock-option-accounts/[accountId]/grants    → createStockOptionGrantForClient
 *   PUT  …/grants/[grantId]                           → updateStockOptionGrantForClient
 * An account is the accounts row, its single owner row and the
 * stock_option_accounts extension; a grant is the grant row, its vest
 * tranches and its planned events. A grant PUT replaces the whole grant.
 *
 * The account routes' test mocks `@/lib/db-scoping` with only
 * `assertAccountsInClient` and `@/lib/clients/authz` with only
 * `verifyClientAccess` / `requireClientEditAccess` — import nothing else from
 * them. `actorId`: the save's actor; a route leaves it out and the audit reads
 * the session, as before.
 */
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/db";
import {
  accountOwners,
  accounts,
  familyMembers,
  scenarios,
  stockOptionAccounts,
  stockOptionGrants,
  stockOptionPlannedEvents,
  stockOptionVestTranches,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { verifyClientAccess } from "@/lib/clients/authz";
import { assertAccountsInClient } from "@/lib/db-scoping";
import { handleOf, inTransaction, type DbOrTx, type WriteOptions } from "@/lib/db-tx";
import { formatZodIssues } from "@/lib/schemas/common";
import {
  grantCreateSchema,
  grantUpdateSchema,
  stockOptionAccountCreateSchema,
  stockOptionAccountUpdateSchema,
  type GrantCreateInput,
  type GrantPlannedEventInput,
  type GrantTrancheInput,
} from "@/lib/schemas/stock-options";
import { writeError, type EntityWriteResult } from "./entity-write-result";

type Grant = typeof stockOptionGrants.$inferSelect;
/** A grant as its routes answer: the row with its tranches and planned events. */
export type GrantWithChildren = Grant & {
  tranches: (typeof stockOptionVestTranches.$inferSelect)[];
  plannedEvents: (typeof stockOptionPlannedEvents.$inferSelect)[];
};

interface Common {
  clientId: string;
  firmId: string;
  actorId?: string;
  input: unknown;
  crossFirmMeta?: Record<string, unknown>;
}

function invalidBody(error: z.ZodError) {
  return writeError(400, "Invalid body", { error: "Invalid body", issues: formatZodIssues(error) });
}

async function getBaseCaseScenarioId(
  clientId: string,
): Promise<string | null> {
  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));

  return scenario?.id ?? null;
}

// Creates an accounts row + accountOwners row + stockOptionAccounts extension
// row in one transaction so a partial write can't leave a dangling account.
export async function createStockOptionAccountForClient(
  args: Common & WriteOptions,
): Promise<EntityWriteResult<{ id: string }>> {
  const { clientId: id, firmId, actorId, crossFirmMeta } = args;
  const handle = handleOf(args);

  const scenarioId = await getBaseCaseScenarioId(id);
  if (!scenarioId) return writeError(404, "Client not found");

  const parsed = stockOptionAccountCreateSchema.safeParse(args.input);
  if (!parsed.success) return invalidBody(parsed.error);
  const input = parsed.data;

  // `destinationAccountId` is the account that receives sold or vested
  // shares. The schema checks that it is a UUID and stops there — nothing
  // checked that it belongs to THIS client, so a foreign id sent the whole
  // position into a balance no report of this client's totals. Audit F50.
  const destCheck = await assertAccountsInClient(id, [input.destinationAccountId], args.tx);
  if (!destCheck.ok) return writeError(400, destCheck.reason);

  // Look up FM ids so we can build the single accountOwners row.
  const fmRows = await handle
    .select({ id: familyMembers.id, role: familyMembers.role })
    .from(familyMembers)
    .where(eq(familyMembers.clientId, id));
  const clientFmId = fmRows.find((f) => f.role === "client")?.id ?? null;
  const spouseFmId = fmRows.find((f) => f.role === "spouse")?.id ?? null;

  const newAccountId = await inTransaction(args, async (tx) => {
    // 1. Insert the accounts row.
    const [acct] = await tx
      .insert(accounts)
      .values({
        clientId: id,
        scenarioId,
        name: input.name,
        category: "stock_options",
        subType: "other",
        value: "0",
        basis: "0",
        ...(input.growthRate != null ? { growthRate: String(input.growthRate) } : {}),
      })
      .returning({ id: accounts.id, name: accounts.name });

    // 2. Insert the single owner row (skip if the family member doesn't exist).
    const ownerFmId = input.owner === "spouse" ? spouseFmId : clientFmId;
    if (ownerFmId != null) {
      await tx.insert(accountOwners).values({
        accountId: acct.id,
        familyMemberId: ownerFmId,
        percent: "1",
      });
    }

    // 3. Insert the stockOptionAccounts extension row.
    await tx.insert(stockOptionAccounts).values({
      accountId: acct.id,
      ticker: input.ticker ?? null,
      isPublic: input.isPublic,
      pricePerShare: String(input.pricePerShare),
      destinationAccountId: input.destinationAccountId ?? null,
      autoCreateDestination: input.autoCreateDestination,
      sellToCover: input.sellToCover,
      withholdingRate: String(input.withholdingRate),
      defaultExerciseTiming: input.defaultExerciseTiming,
      defaultExerciseYear: input.defaultExerciseYear ?? null,
      defaultSellTiming: input.defaultSellTiming,
      defaultSellYear: input.defaultSellYear ?? null,
      defaultSellPercentPerYear:
        input.defaultSellPercentPerYear != null
          ? String(input.defaultSellPercentPerYear)
          : null,
      defaultSellStartYear: input.defaultSellStartYear ?? null,
    });

    return acct.id;
  });

  await recordAudit({
    action: "account.stock_options.create",
    resourceType: "stock_option_account",
    resourceId: newAccountId,
    clientId: id,
    firmId,
    actorId,
    metadata: { name: input.name, ticker: input.ticker ?? null, ...crossFirmMeta },
    tx: args.tx,
  });

  return { ok: true, data: { id: newAccountId }, resourceId: newAccountId };
}

/**
 * Tenant-isolation: confirm target account exists, belongs to this client,
 * and is a stock-options account. The PUT route runs it before reading the
 * body (a 404 comes before a 400); the update repeats it on its handle.
 */
export async function findStockOptionAccount(clientId: string, accountId: string, handle?: DbOrTx) {
  const [target] = await (handle ?? db)
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.id, accountId),
        eq(accounts.clientId, clientId),
        eq(accounts.category, "stock_options"),
      ),
    );
  return target;
}

// Partial update of a stock-option account (accounts row + owner + extension).
export async function updateStockOptionAccountForClient(
  args: Common & { accountId: string } & WriteOptions,
): Promise<EntityWriteResult<{ id: string }>> {
  const { clientId: id, firmId, actorId, accountId, crossFirmMeta } = args;
  const handle = handleOf(args);

  const target = await findStockOptionAccount(id, accountId, args.tx);
  if (!target) return writeError(404, "Account not found");

  const parsed = stockOptionAccountUpdateSchema.safeParse(args.input);
  if (!parsed.success) return invalidBody(parsed.error);
  const input = parsed.data;

  // `destinationAccountId` is the account that receives sold or vested
  // shares. The schema checks that it is a UUID and stops there — nothing
  // checked that it belongs to THIS client, so a foreign id sent the whole
  // position into a balance no report of this client's totals. Audit F50.
  const destCheck = await assertAccountsInClient(id, [input.destinationAccountId], args.tx);
  if (!destCheck.ok) return writeError(400, destCheck.reason);

  // Look up FM ids for potential owner replacement.
  const fmRows = await handle
    .select({ id: familyMembers.id, role: familyMembers.role })
    .from(familyMembers)
    .where(eq(familyMembers.clientId, id));
  const clientFmId = fmRows.find((f) => f.role === "client")?.id ?? null;
  const spouseFmId = fmRows.find((f) => f.role === "spouse")?.id ?? null;

  await inTransaction(args, async (tx) => {
    // --- accounts row ---
    const acctUpdates: Record<string, unknown> = {};
    if (input.name !== undefined) acctUpdates.name = input.name;
    if (input.growthRate !== undefined) {
      acctUpdates.growthRate = input.growthRate != null ? String(input.growthRate) : null;
    }
    if (Object.keys(acctUpdates).length > 0) {
      acctUpdates.updatedAt = new Date();
      await tx
        .update(accounts)
        .set(acctUpdates)
        .where(and(eq(accounts.id, accountId), eq(accounts.clientId, id)));
    }

    // --- account_owners: full replacement when owner is provided ---
    // Mirrors the insurance route: if the requested owner's family member
    // doesn't exist (e.g. owner "spouse" but no spouse on file), the row is
    // left ownerless rather than synthesizing a bogus owner.
    if (input.owner !== undefined) {
      await tx.delete(accountOwners).where(eq(accountOwners.accountId, accountId));
      const ownerFmId = input.owner === "spouse" ? spouseFmId : clientFmId;
      if (ownerFmId != null) {
        await tx.insert(accountOwners).values({
          accountId,
          familyMemberId: ownerFmId,
          percent: "1",
        });
      }
    }

    // --- stockOptionAccounts extension row ---
    const extUpdates: Record<string, unknown> = {};
    if (input.ticker !== undefined) extUpdates.ticker = input.ticker ?? null;
    if (input.isPublic !== undefined) extUpdates.isPublic = input.isPublic;
    if (input.pricePerShare !== undefined) {
      extUpdates.pricePerShare = String(input.pricePerShare);
    }
    if (input.destinationAccountId !== undefined) {
      extUpdates.destinationAccountId = input.destinationAccountId ?? null;
    }
    if (input.autoCreateDestination !== undefined) {
      extUpdates.autoCreateDestination = input.autoCreateDestination;
    }
    if (input.sellToCover !== undefined) extUpdates.sellToCover = input.sellToCover;
    if (input.withholdingRate !== undefined) {
      extUpdates.withholdingRate = String(input.withholdingRate);
    }
    if (input.defaultExerciseTiming !== undefined) {
      extUpdates.defaultExerciseTiming = input.defaultExerciseTiming;
    }
    if (input.defaultExerciseYear !== undefined) {
      extUpdates.defaultExerciseYear = input.defaultExerciseYear ?? null;
    }
    if (input.defaultSellTiming !== undefined) {
      extUpdates.defaultSellTiming = input.defaultSellTiming;
    }
    if (input.defaultSellYear !== undefined) {
      extUpdates.defaultSellYear = input.defaultSellYear ?? null;
    }
    if (input.defaultSellPercentPerYear !== undefined) {
      extUpdates.defaultSellPercentPerYear =
        input.defaultSellPercentPerYear != null
          ? String(input.defaultSellPercentPerYear)
          : null;
    }
    if (input.defaultSellStartYear !== undefined) {
      extUpdates.defaultSellStartYear = input.defaultSellStartYear ?? null;
    }
    if (Object.keys(extUpdates).length > 0) {
      extUpdates.updatedAt = new Date();
      await tx
        .update(stockOptionAccounts)
        .set(extUpdates)
        .where(eq(stockOptionAccounts.accountId, accountId));
    }
  });

  await recordAudit({
    action: "account.stock_options.update",
    resourceType: "stock_option_account",
    resourceId: accountId,
    clientId: id,
    firmId,
    actorId,
    metadata: { name: target.name, fieldsChanged: Object.keys(input), ...crossFirmMeta },
    tx: args.tx,
  });

  return { ok: true, data: { id: accountId }, resourceId: accountId };
}

/** The grant columns a POST inserts and a PUT overwrites — every optional one null when absent. */
function grantColumns(input: Omit<GrantCreateInput, "plannedEvents">) {
  return {
    grantNumber: input.grantNumber ?? null,
    grantType: input.grantType,
    grantDate: input.grantDate,
    sharesGranted: String(input.sharesGranted),
    has83bElection: input.has83bElection,
    fmvAtGrant: input.fmvAtGrant != null ? String(input.fmvAtGrant) : null,
    strikePrice: input.strikePrice != null ? String(input.strikePrice) : null,
    strikeDiscountPct:
      input.strikeDiscountPct != null ? String(input.strikeDiscountPct) : null,
    expirationDate: input.expirationDate ?? null,
    exerciseTiming: input.exerciseTiming ?? null,
    exerciseYear: input.exerciseYear ?? null,
    sellTiming: input.sellTiming ?? null,
    sellYear: input.sellYear ?? null,
    sellPercentPerYear:
      input.sellPercentPerYear != null ? String(input.sellPercentPerYear) : null,
    sellStartYear: input.sellStartYear ?? null,
    notes: input.notes ?? null,
  };
}

/** Vest tranche rows (sortOrder by array index). */
function trancheValues(grantId: string, tranches: GrantTrancheInput[]) {
  return tranches.map((t, i) => ({
    grantId,
    vestDate: t.vestDate,
    shares: String(t.shares),
    sharesExercised: String(t.sharesExercised),
    sharesSold: String(t.sharesSold),
    // The real pre-plan acquisition. Decimal columns take STRINGS in
    // Drizzle — a raw number silently loses scale.
    acquiredOn: t.acquiredOn ?? null,
    priceAtAcquisition:
      t.priceAtAcquisition != null ? String(t.priceAtAcquisition) : null,
    exerciseTiming: t.exerciseTiming ?? null,
    exerciseYear: t.exerciseYear ?? null,
    sellTiming: t.sellTiming ?? null,
    sellYear: t.sellYear ?? null,
    sellPercentPerYear:
      t.sellPercentPerYear != null ? String(t.sellPercentPerYear) : null,
    sellStartYear: t.sellStartYear ?? null,
    sortOrder: i,
  }));
}

// v1: planned events are grant-level; tranche targeting deferred.
function eventValues(grantId: string, events: GrantPlannedEventInput[]) {
  return events.map((e) => ({
    grantId,
    trancheId: null,
    year: e.year,
    action: e.action,
    shares: e.shares != null ? String(e.shares) : null,
    pct: e.pct != null ? String(e.pct) : null,
  }));
}

// Creates a grant + its tranches + planned events in one transaction.
export async function createStockOptionGrantForClient(
  args: Common & { accountId: string } & WriteOptions,
): Promise<EntityWriteResult<GrantWithChildren>> {
  const { clientId: id, firmId, actorId, accountId, crossFirmMeta } = args;
  const handle = handleOf(args);

  // Org-scope guard: verify client → account ownership and category.
  const access = await verifyClientAccess(id);
  if (!access.ok) return writeError(404, "Client not found");
  const [account] = await handle
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.id, accountId),
        eq(accounts.clientId, id),
        eq(accounts.category, "stock_options"),
      ),
    );
  if (!account) return writeError(404, "Account not found");

  const parsed = grantCreateSchema.safeParse(args.input);
  if (!parsed.success) return invalidBody(parsed.error);
  const input = parsed.data;

  const result = await inTransaction(args, async (tx) => {
    // 1. Insert the grant row.
    const [grant] = await tx
      .insert(stockOptionGrants)
      .values({ accountId, ...grantColumns(input), sortOrder: 0 })
      .returning();

    // 2. Insert vest tranches (assign sortOrder by array index).
    const insertedTranches = input.tranches.length > 0
      ? await tx.insert(stockOptionVestTranches).values(trancheValues(grant.id, input.tranches)).returning()
      : [];

    // 3. Insert planned events.
    const insertedEvents = input.plannedEvents.length > 0
      ? await tx.insert(stockOptionPlannedEvents).values(eventValues(grant.id, input.plannedEvents)).returning()
      : [];

    return { grant, tranches: insertedTranches, plannedEvents: insertedEvents };
  });

  await recordAudit({
    action: "account.stock_options.grant.create",
    resourceType: "stock_option_grant",
    resourceId: result.grant.id,
    clientId: id,
    firmId,
    actorId,
    metadata: { accountId, grantType: input.grantType, ...crossFirmMeta },
    tx: args.tx,
  });

  return {
    ok: true,
    data: { ...result.grant, tranches: result.tranches, plannedEvents: result.plannedEvents },
    resourceId: result.grant.id,
  };
}

// Full replacement of grant fields + tranches + planned events in one transaction.
export async function updateStockOptionGrantForClient(
  args: Common & { accountId: string; grantId: string } & WriteOptions,
): Promise<EntityWriteResult<GrantWithChildren>> {
  const { clientId: id, firmId, actorId, accountId, grantId, crossFirmMeta } = args;
  const handle = handleOf(args);

  // Org-scope guard: verify client → account → grant ownership.
  const access = await verifyClientAccess(id);
  if (!access.ok) return writeError(404, "Client not found");
  if (access.permission !== "edit") return writeError(403, "View-only access");
  const [account] = await handle
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.id, accountId),
        eq(accounts.clientId, id),
        eq(accounts.category, "stock_options"),
      ),
    );
  if (!account) return writeError(404, "Account not found");
  const [grant] = await handle
    .select()
    .from(stockOptionGrants)
    .where(
      and(eq(stockOptionGrants.id, grantId), eq(stockOptionGrants.accountId, accountId)),
    );
  if (!grant) return writeError(404, "Grant not found");

  const parsed = grantUpdateSchema.safeParse(args.input);
  if (!parsed.success) return invalidBody(parsed.error);
  const input = parsed.data;

  const result = await inTransaction(args, async (tx) => {
    // 1. Update grant row fields.
    const [updatedGrant] = await tx
      .update(stockOptionGrants)
      .set({ ...grantColumns(input), updatedAt: new Date() })
      .where(and(eq(stockOptionGrants.id, grantId), eq(stockOptionGrants.accountId, accountId)))
      .returning();
    // The guard already confirmed the row exists; this narrows the type and
    // guards against a silent no-op if the guard logic ever drifts.
    if (!updatedGrant) throw new Error("Grant update failed — row not found");

    // 2. Replace tranches: delete existing, reinsert from input.
    await tx.delete(stockOptionVestTranches).where(eq(stockOptionVestTranches.grantId, grantId));
    const insertedTranches = input.tranches.length > 0
      ? await tx.insert(stockOptionVestTranches).values(trancheValues(grantId, input.tranches)).returning()
      : [];

    // 3. Replace planned events: delete existing, reinsert from input.
    //
    // An ABSENT `plannedEvents` key means "leave them alone". The grant
    // editor has no screen for planned events but used to send an empty list
    // on every save, so the route deleted any that existed — and a grant on
    // "manual" exercise timing depends entirely on them. Audit F18/F33.
    const events = input.plannedEvents;
    let insertedEvents;
    if (events === undefined) {
      // Untouched — echo back what is stored so the response still describes
      // the whole grant.
      insertedEvents = await tx
        .select()
        .from(stockOptionPlannedEvents)
        .where(eq(stockOptionPlannedEvents.grantId, grantId));
    } else {
      await tx.delete(stockOptionPlannedEvents).where(eq(stockOptionPlannedEvents.grantId, grantId));
      insertedEvents =
        events.length > 0
          ? await tx.insert(stockOptionPlannedEvents).values(eventValues(grantId, events)).returning()
          : [];
    }

    return { grant: updatedGrant, tranches: insertedTranches, plannedEvents: insertedEvents };
  });

  await recordAudit({
    action: "account.stock_options.grant.update",
    resourceType: "stock_option_grant",
    resourceId: grantId,
    clientId: id,
    firmId,
    actorId,
    metadata: { accountId, grantType: input.grantType, ...crossFirmMeta },
    tx: args.tx,
  });

  return {
    ok: true,
    data: { ...result.grant, tranches: result.tranches, plannedEvents: result.plannedEvents },
    resourceId: grantId,
  };
}
