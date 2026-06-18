import { db } from "@/db";
import {
  clients,
  crmHouseholds,
  accounts,
  entities,
  entityOwners,
} from "@/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";

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

  // 4. Assemble rows (relationship signals filled in Task 2).
  const rows: ClientSignalRow[] = baseRows.map((b) => {
    const p = portfolio.get(b.clientId) ?? { net: 0, liquid: 0, cash: 0 };
    return {
      clientId: b.clientId,
      name: b.name,
      netWorth: p.net + (businessShareByClient.get(b.clientId) ?? 0),
      liquid: p.liquid,
      cashBalance: p.cash,
      lastContactDays: null,
      openTasks: 0,
      openItems: 0,
      pendingImport: false,
    };
  });

  // Filtering/sort/limit added in Task 3; for now return everything.
  const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = opts.offset ?? 0;
  const page = rows.slice(offset, offset + limit);
  return { rows: page, totalCount: rows.length, truncated: offset + page.length < rows.length };
}
