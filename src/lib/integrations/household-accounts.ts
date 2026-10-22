// src/lib/integrations/household-accounts.ts
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  accounts,
  clientImports,
  clients,
  crmHouseholds,
  familyMembers,
  integrationConnections,
  integrationHouseholdLinks,
  scenarios,
} from "@/db/schema";
import type { AccountCategory, AccountSubType, ExtractedAccount } from "@/lib/extraction/types";

import { buildReviewAccounts, commitProviderAccounts, upsertOpenReview } from "./commit";
import { getProvider } from "./registry";
import type { SyncingProviderId } from "./types";

/** One account from a household's last pull, as the account panel lists it. */
export type PanelAccountRow = {
  externalId: string;
  name: string;
  value: number | null;
  guessedCategory: AccountCategory;
  guessedSubType: AccountSubType;
  /** The plan account it feeds; null when it isn't connected. */
  planAccount: { id: string; name: string } | null;
};

/** A plan account Connect can feed: in the client's base case, and fed by no provider. */
export type PanelPlanAccount = { id: string; name: string; category: string; subType: string; value: number };

export type HouseholdAccountsPanel = {
  /** The linked client's household name in the plan (the link stores no provider group name). */
  householdName: string;
  connectionName: string;
  pulledAt: Date | null;
  hasSpouse: boolean;
  rows: PanelAccountRow[];
  candidates: PanelPlanAccount[];
};

/**
 * A panel action the plan refuses: the account isn't in the last pull, or it,
 * or the plan account, is already tied. The message is in plain words for the
 * advisor, and the route answers 409 with it.
 */
export class AccountPanelRefusal extends Error {}

type PanelInput = { connectionId: string; linkId: string; providerId: SyncingProviderId };

const uuid = z.uuid();
// A non-UUID id would make Postgres reject the query, turning a probe into a 500.
const validIds = (...ids: string[]) => ids.every((id) => uuid.safeParse(id).success);

/** The link, only when it's on this connection; null otherwise, a malformed id included. */
export async function findLinkOnConnection(i: {
  connectionId: string;
  linkId: string;
}): Promise<{ id: string; clientId: string } | null> {
  if (!validIds(i.connectionId, i.linkId)) return null;
  const l = integrationHouseholdLinks;
  const [link] = await db
    .select({ id: l.id, clientId: l.clientId })
    .from(l)
    .where(and(eq(l.id, i.linkId), eq(l.connectionId, i.connectionId)))
    .limit(1);
  return link ?? null;
}

type PanelContext = NonNullable<Awaited<ReturnType<typeof loadPanelContext>>>;

/**
 * Everything a panel read or action works from, with no provider call: the
 * link's last pull, its client's base case and every plan account in it, and
 * the connection's owner (who files any review). Null when the link isn't on
 * this connection.
 */
async function loadPanelContext(i: PanelInput) {
  if (!validIds(i.connectionId, i.linkId)) return null;
  const l = integrationHouseholdLinks;
  const [row] = await db
    .select({
      clientId: l.clientId,
      firmId: l.firmId,
      pulled: l.lastPullAccounts,
      pulledAt: l.lastPulledAt,
      ownerUserId: integrationConnections.ownerUserId,
      connectionName: integrationConnections.name,
      householdName: crmHouseholds.name,
      scenarioId: scenarios.id,
    })
    .from(l)
    .innerJoin(integrationConnections, eq(integrationConnections.id, l.connectionId))
    .innerJoin(clients, eq(clients.id, l.clientId))
    .innerJoin(crmHouseholds, eq(crmHouseholds.id, clients.crmHouseholdId))
    .innerJoin(scenarios, and(eq(scenarios.clientId, l.clientId), eq(scenarios.isBaseCase, true)))
    .where(and(eq(l.id, i.linkId), eq(l.connectionId, i.connectionId), eq(l.provider, i.providerId)))
    .limit(1);
  // A syncing connection always has an owner; without one a review would sit unopenable.
  if (!row?.ownerUserId) return null;

  const planAccounts = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      category: accounts.category,
      subType: accounts.subType,
      value: accounts.value,
      externalProvider: accounts.externalProvider,
      externalId: accounts.externalId,
    })
    .from(accounts)
    .where(and(eq(accounts.clientId, row.clientId), eq(accounts.scenarioId, row.scenarioId)))
    .orderBy(asc(accounts.name));

  return { ...row, ownerUserId: row.ownerUserId, pulled: row.pulled ?? [], planAccounts };
}

async function requirePanelContext(i: PanelInput): Promise<PanelContext> {
  const ctx = await loadPanelContext(i);
  if (!ctx) throw new AccountPanelRefusal("That household isn't linked through this connection any more.");
  return ctx;
}

/** The account from the last pull, refused when it isn't there or a plan account already carries it. */
function untiedPulledAccount(ctx: PanelContext, providerId: SyncingProviderId, externalId: string): ExtractedAccount {
  const pulled = ctx.pulled.find((a) => a.externalId === externalId);
  if (!pulled) {
    throw new AccountPanelRefusal("That account isn't in this household's last sync. Sync again, then try once more.");
  }
  const tied = ctx.planAccounts.find((a) => a.externalProvider === providerId && a.externalId === externalId);
  if (tied) throw new AccountPanelRefusal(`That account is already in the plan as “${tied.name}”.`);
  return pulled;
}

/**
 * Keeps the client's open review from this provider in step with the panel.
 * Its rows are rebuilt from the last pull and the CURRENT ties, the same
 * inputs `syncConnection` uses, so a connected account is `exact` to its plan
 * account and an untied one is `new`. Committing the review then updates in
 * place and never adds a second copy. The panel action wins over row edits
 * made on the review screen. No open review means nothing to do.
 */
async function rebuildOpenReview(ctx: PanelContext, providerId: SyncingProviderId): Promise<void> {
  const [open] = await db
    .select({ id: clientImports.id })
    .from(clientImports)
    .where(
      and(
        eq(clientImports.clientId, ctx.clientId),
        eq(clientImports.origin, providerId),
        eq(clientImports.status, "review"),
      ),
    )
    .limit(1);
  if (!open) return;

  const ties = await db
    .select({ id: accounts.id, externalId: accounts.externalId })
    .from(accounts)
    .where(
      and(
        eq(accounts.clientId, ctx.clientId),
        eq(accounts.externalProvider, providerId),
        eq(accounts.scenarioId, ctx.scenarioId),
      ),
    );
  const provider = getProvider(providerId);
  await upsertOpenReview({
    clientId: ctx.clientId,
    firmId: ctx.firmId,
    scenarioId: ctx.scenarioId,
    providerId,
    ownerUserId: ctx.ownerUserId,
    accounts: buildReviewAccounts({
      pulled: ctx.pulled,
      ties,
      autoCommitExact: provider.syncs && provider.autoCommitExact,
    }),
  });
}

/** The account panel for one linked household, from its last pull and the plan. Null when the link isn't on this connection. */
export async function loadHouseholdAccounts(i: PanelInput): Promise<HouseholdAccountsPanel | null> {
  const ctx = await loadPanelContext(i);
  if (!ctx) return null;

  const [spouse] = await db
    .select({ id: familyMembers.id })
    .from(familyMembers)
    .where(and(eq(familyMembers.clientId, ctx.clientId), eq(familyMembers.role, "spouse")))
    .limit(1);
  const tieOf = new Map(
    ctx.planAccounts.flatMap((a) =>
      a.externalProvider === i.providerId && a.externalId ? [[a.externalId, a] as const] : [],
    ),
  );

  return {
    householdName: ctx.householdName,
    connectionName: ctx.connectionName ?? getProvider(i.providerId).label,
    pulledAt: ctx.pulledAt,
    hasSpouse: Boolean(spouse),
    rows: ctx.pulled.flatMap((a) => {
      if (!a.externalId) return [];
      const tie = tieOf.get(a.externalId);
      return [
        {
          externalId: a.externalId,
          name: a.name,
          value: a.value ?? null,
          // The registration table's own fallback, for a pull row stored without a guess.
          guessedCategory: a.category ?? "taxable",
          guessedSubType: a.subType ?? "brokerage",
          planAccount: tie ? { id: tie.id, name: tie.name } : null,
        },
      ];
    }),
    candidates: ctx.planAccounts
      .filter((a) => a.externalProvider === null)
      .map((a) => ({ id: a.id, name: a.name, category: a.category, subType: a.subType, value: Number(a.value) })),
  };
}

/**
 * Feeds an existing plan account from one account in the last pull: Addepar's
 * value, cost basis and holdings, and the tie. The plan account keeps its
 * type, sub-type, name, custodian, account number and owners, because the
 * provider's type is only a guess (from the account's name, for Addepar).
 */
export async function connectHouseholdAccount(
  i: PanelInput & { externalId: string; planAccountId: string; userId: string },
): Promise<void> {
  const ctx = await requirePanelContext(i);
  const pulled = untiedPulledAccount(ctx, i.providerId, i.externalId);
  const target = ctx.planAccounts.find((a) => a.id === i.planAccountId);
  if (!target) throw new AccountPanelRefusal("That account isn't in this client's plan.");
  if (target.externalProvider !== null) {
    throw new AccountPanelRefusal(`“${target.name}” is already connected. Disconnect it first.`);
  }

  await commitProviderAccounts({
    clientId: ctx.clientId,
    scenarioId: ctx.scenarioId,
    firmId: ctx.firmId,
    userId: i.userId,
    providerId: i.providerId,
    // The exact branch of `commitAccounts` writes only the fields a row
    // carries (and never owners, nor the name without an override), so
    // leaving category, sub-type, custodian, account number and owner out of
    // this row is what keeps the plan's identity.
    accounts: [
      {
        name: pulled.name,
        value: pulled.value,
        basis: pulled.basis,
        holdings: pulled.holdings,
        externalProvider: i.providerId,
        externalId: i.externalId,
        match: { kind: "exact", existingId: target.id },
      },
    ],
  });
  await rebuildOpenReview(ctx, i.providerId);
}

/**
 * Adds one account from the last pull to the plan as a new account, with the
 * type and owner the advisor chose over the provider's guess. Returns the new
 * plan account's id.
 */
export async function addHouseholdAccount(
  i: PanelInput & {
    externalId: string;
    category: AccountCategory;
    subType: AccountSubType;
    owner: "client" | "spouse" | "joint";
    userId: string;
  },
): Promise<string> {
  const ctx = await requirePanelContext(i);
  const pulled = untiedPulledAccount(ctx, i.providerId, i.externalId);

  await commitProviderAccounts({
    clientId: ctx.clientId,
    scenarioId: ctx.scenarioId,
    firmId: ctx.firmId,
    userId: i.userId,
    providerId: i.providerId,
    accounts: [
      { ...pulled, category: i.category, subType: i.subType, owner: i.owner, match: { kind: "new" } },
    ],
  });
  const [created] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.clientId, ctx.clientId),
        eq(accounts.scenarioId, ctx.scenarioId),
        eq(accounts.externalProvider, i.providerId),
        eq(accounts.externalId, i.externalId),
      ),
    )
    .limit(1);
  await rebuildOpenReview(ctx, i.providerId);
  return created.id;
}

/**
 * Stops the provider feeding a plan account. It keeps its last numbers and
 * holdings and becomes a hand-kept account. Returns the provider account id it
 * was tied to.
 */
export async function disconnectPlanAccount(
  i: PanelInput & { planAccountId: string; userId: string },
): Promise<string | null> {
  const ctx = await requirePanelContext(i);
  const notConnected = () =>
    new AccountPanelRefusal(`That account isn't connected to ${getProvider(i.providerId).label}.`);
  const target = ctx.planAccounts.find((a) => a.id === i.planAccountId && a.externalProvider === i.providerId);
  if (!target) throw notConnected();

  const untied = await db
    .update(accounts)
    .set({ externalProvider: null, externalId: null, lastSyncedAt: null, source: "manual", updatedAt: new Date() })
    .where(
      and(
        eq(accounts.id, target.id),
        eq(accounts.clientId, ctx.clientId),
        eq(accounts.externalProvider, i.providerId),
      ),
    )
    .returning({ id: accounts.id });
  // Someone disconnected it between the read and this write.
  if (untied.length === 0) throw notConnected();

  await rebuildOpenReview(ctx, i.providerId);
  return target.externalId;
}
