import { db } from "@/db";
import {
  clients,
  crmHouseholds,
  accounts,
  entities,
  entityOwners,
  crmActivity,
  crmTasks,
  clientOpenItems,
  clientImports,
} from "@/db/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

export type SignalKey =
  | "netWorth"
  | "liquid"
  | "cashBalance"
  | "lastContactDays"
  | "openTasks"
  | "openItems";

export interface ScanBookFilters {
  lastContactDaysOver?: number;
  lastContactDaysUnder?: number;
  cashAtLeast?: number;
  liquidAtLeast?: number;
  netWorthUnder?: number;
  hasPendingImport?: boolean;
  hasOpenItems?: boolean;
  minOpenTasks?: number;
}

export interface ScanBookOptions {
  sortBy?: SignalKey;
  direction?: "asc" | "desc";
  filters?: ScanBookFilters;
  limit?: number;
  offset?: number;
}

export interface ClientSignalRow {
  clientId: string;
  name: string;
  netWorth: number;
  liquid: number;
  cashBalance: number;
  lastContactDays: number | null;
  openTasks: number;
  openItems: number;
  pendingImport: boolean;
}

export interface ScanBookResult {
  rows: ClientSignalRow[];
  totalCount: number;
  truncated: boolean;
}

// Mirror of get-overview-data.ts so book-scan net worth == client_briefing.
const LIQUID_CATEGORY_EXCLUDE = new Set(["real_estate", "business", "life_insurance"]);
const BUSINESS_ENTITY_TYPES = new Set(["llc", "s_corp", "c_corp", "partnership", "other"]);

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

export async function scanBook(
  ctx: { firmId: string; advisorId: string },
  opts: ScanBookOptions,
): Promise<ScanBookResult> {
  // 1. Base: the caller's own, non-deleted clients.
  const baseRows = await db
    .select({ clientId: clients.id, householdId: clients.crmHouseholdId, name: crmHouseholds.name })
    .from(clients)
    .innerJoin(crmHouseholds, eq(crmHouseholds.id, clients.crmHouseholdId))
    .where(
      and(
        eq(clients.firmId, ctx.firmId),
        eq(clients.advisorId, ctx.advisorId),
        isNull(crmHouseholds.deletedAt),
      ),
    );

  const clientIds = baseRows.map((r) => r.clientId);
  if (clientIds.length === 0) {
    return { rows: [], totalCount: 0, truncated: false };
  }

  // 2. Accounts → netWorth(partial)/liquid/cash, grouped in JS.
  const accountRows = await db
    .select({ clientId: accounts.clientId, category: accounts.category, value: accounts.value })
    .from(accounts)
    .where(inArray(accounts.clientId, clientIds));

  const portfolio = new Map<string, { net: number; liquid: number; cash: number }>();
  for (const a of accountRows) {
    const v = Number(a.value ?? 0);
    const p = portfolio.get(a.clientId) ?? { net: 0, liquid: 0, cash: 0 };
    p.net += v;
    if (!LIQUID_CATEGORY_EXCLUDE.has(String(a.category))) p.liquid += v;
    if (a.category === "cash") p.cash += v;
    portfolio.set(a.clientId, p);
  }

  // 3. Business-entity family share → add to netWorth (mirrors get-overview-data.ts).
  const entityRows = await db
    .select({ id: entities.id, clientId: entities.clientId, entityType: entities.entityType, value: entities.value })
    .from(entities)
    .where(inArray(entities.clientId, clientIds));

  const businessEntities = entityRows.filter(
    (e) => e.entityType && BUSINESS_ENTITY_TYPES.has(e.entityType) && Number(e.value ?? 0) > 0,
  );
  const businessEntityIds = businessEntities.map((e) => e.id);
  const ownerRows = businessEntityIds.length
    ? await db
        .select({ entityId: entityOwners.entityId, percent: entityOwners.percent })
        .from(entityOwners)
        .where(inArray(entityOwners.entityId, businessEntityIds))
    : [];

  const ownerSumByEntity = new Map<string, number>();
  const entitiesWithOwners = new Set<string>();
  for (const o of ownerRows) {
    entitiesWithOwners.add(o.entityId);
    ownerSumByEntity.set(o.entityId, (ownerSumByEntity.get(o.entityId) ?? 0) + parseFloat(o.percent));
  }
  const businessShareByClient = new Map<string, number>();
  for (const e of businessEntities) {
    const v = Number(e.value ?? 0);
    const familyShare = entitiesWithOwners.has(e.id)
      ? Math.max(0, Math.min(1, ownerSumByEntity.get(e.id) ?? 0))
      : 1;
    businessShareByClient.set(e.clientId, (businessShareByClient.get(e.clientId) ?? 0) + v * familyShare);
  }

  const householdIds = baseRows.map((r) => r.householdId);

  // lastContact: MAX(occurred_at) per household — returned as epoch seconds to
  // avoid JS parsing ambiguity with timezone-unqualified timestamp strings.
  const activityRows = await db
    .select({
      householdId: crmActivity.householdId,
      lastEpochSec: sql<number>`extract(epoch from max(${crmActivity.occurredAt}))`,
    })
    .from(crmActivity)
    .where(inArray(crmActivity.householdId, householdIds))
    .groupBy(crmActivity.householdId);
  const lastContactByHousehold = new Map<string, number>();
  for (const r of activityRows) if (r.lastEpochSec != null) lastContactByHousehold.set(r.householdId, r.lastEpochSec);

  // open CRM tasks per household.
  const taskRows = await db
    .select({ householdId: crmTasks.householdId, n: sql<number>`count(*)::int` })
    .from(crmTasks)
    .where(
      and(
        inArray(crmTasks.householdId, householdIds),
        inArray(crmTasks.status, ["open", "in_progress", "blocked"]),
      ),
    )
    .groupBy(crmTasks.householdId);
  const openTasksByHousehold = new Map<string, number>();
  for (const r of taskRows) openTasksByHousehold.set(r.householdId, r.n);

  // open planning items per client (completed_at IS NULL).
  const openItemRows = await db
    .select({ clientId: clientOpenItems.clientId, n: sql<number>`count(*)::int` })
    .from(clientOpenItems)
    .where(and(inArray(clientOpenItems.clientId, clientIds), isNull(clientOpenItems.completedAt)))
    .groupBy(clientOpenItems.clientId);
  const openItemsByClient = new Map<string, number>();
  for (const r of openItemRows) openItemsByClient.set(r.clientId, r.n);

  // pending imports per client.
  const pendingImportRows = await db
    .selectDistinct({ clientId: clientImports.clientId })
    .from(clientImports)
    .where(
      and(
        inArray(clientImports.clientId, clientIds),
        inArray(clientImports.status, ["draft", "extracting", "review"]),
      ),
    );
  const pendingImportClients = new Set(pendingImportRows.map((r) => r.clientId));

  const nowSec = Date.now() / 1000;
  const daysSince = (epochSec: number | undefined): number | null =>
    epochSec == null ? null : Math.floor((nowSec - epochSec) / 86400);

  // 4. Assemble rows.
  const rows: ClientSignalRow[] = baseRows.map((b) => {
    const p = portfolio.get(b.clientId) ?? { net: 0, liquid: 0, cash: 0 };
    return {
      clientId: b.clientId,
      name: b.name,
      netWorth: p.net + (businessShareByClient.get(b.clientId) ?? 0),
      liquid: p.liquid,
      cashBalance: p.cash,
      lastContactDays: daysSince(lastContactByHousehold.get(b.householdId)),
      openTasks: openTasksByHousehold.get(b.householdId) ?? 0,
      openItems: openItemsByClient.get(b.clientId) ?? 0,
      pendingImport: pendingImportClients.has(b.clientId),
    };
  });

  // Filtering/sort/limit added in Task 3; for now return everything.
  const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = opts.offset ?? 0;
  const page = rows.slice(offset, offset + limit);
  return { rows: page, totalCount: rows.length, truncated: offset + page.length < rows.length };
}
