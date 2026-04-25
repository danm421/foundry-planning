import { db } from "@/db";
import { auditLog, clients } from "@/db/schema";
import { and, eq, lt, or, gte, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

export type ActionKind = "create" | "update" | "delete" | "other";
export type DateRange = "7d" | "30d" | "90d" | "all";

export type ActivityFilters = {
  actorId: string | null;
  resourceType: string | null;
  actionKind: ActionKind | null;
  range: DateRange;
};

export type ActivityCursor = { createdAt: Date; id: string };

export type ActivityRow = {
  id: string;
  action: string;
  actorId: string;
  resourceType: string;
  resourceId: string;
  clientId: string | null;
  metadata: unknown;
  createdAt: Date;
};

const RANGE_DAYS: Record<DateRange, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
};

function isDateRange(value: unknown): value is DateRange {
  return value === "7d" || value === "30d" || value === "90d" || value === "all";
}

export function parseDateRange(
  raw: string | null | undefined,
  now: Date = new Date(),
): { since: Date | null } {
  const range: DateRange = isDateRange(raw) ? raw : "90d";
  const days = RANGE_DAYS[range];
  if (days === null) return { since: null };
  return { since: new Date(now.getTime() - days * 24 * 60 * 60 * 1000) };
}

export function buildActivityWhere(args: {
  clientId: string;
  firmId: string;
  filters: ActivityFilters;
  cursor: ActivityCursor | null;
  now: Date;
}): SQL {
  const { clientId, firmId, filters, cursor, now } = args;

  const clauses: SQL[] = [
    eq(auditLog.clientId, clientId),
    eq(auditLog.firmId, firmId),
  ];

  if (filters.actorId) clauses.push(eq(auditLog.actorId, filters.actorId));
  if (filters.resourceType)
    clauses.push(eq(auditLog.resourceType, filters.resourceType));
  if (filters.actionKind) {
    clauses.push(sql`${auditLog.metadata}->>'kind' = ${filters.actionKind}`);
  }

  const { since } = parseDateRange(filters.range, now);
  if (since) clauses.push(gte(auditLog.createdAt, since));

  if (cursor) {
    clauses.push(
      or(
        lt(auditLog.createdAt, cursor.createdAt),
        and(eq(auditLog.createdAt, cursor.createdAt), lt(auditLog.id, cursor.id)),
      )!,
    );
  }

  return and(...clauses)!;
}

export async function listClientActivity(args: {
  clientId: string;
  firmId: string;
  filters: ActivityFilters;
  cursor: ActivityCursor | null;
  limit: number;
  now?: Date;
}): Promise<{ rows: ActivityRow[]; nextCursor: ActivityCursor | null }> {
  const { clientId, firmId, filters, cursor, limit } = args;
  const now = args.now ?? new Date();

  const where = buildActivityWhere({ clientId, firmId, filters, cursor, now });

  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      actorId: auditLog.actorId,
      resourceType: auditLog.resourceType,
      resourceId: auditLog.resourceId,
      clientId: auditLog.clientId,
      metadata: auditLog.metadata,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .innerJoin(clients, eq(clients.id, auditLog.clientId))
    .where(where)
    .orderBy(sql`${auditLog.createdAt} DESC`, sql`${auditLog.id} DESC`)
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const trimmed = hasMore ? rows.slice(0, limit) : rows;
  const last = trimmed[trimmed.length - 1];
  const nextCursor: ActivityCursor | null =
    hasMore && last ? { createdAt: last.createdAt, id: last.id } : null;

  return { rows: trimmed, nextCursor };
}
