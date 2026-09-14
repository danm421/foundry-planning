// src/lib/statement-chat/existing-rows.ts
import { eq, getTableColumns, is } from "drizzle-orm";
import { PgTable, type PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db";
import * as schema from "@/db/schema";
import type { DetailEntity } from "@/domain/forge/detail-fields";
import type { ExistingRow } from "@/lib/entity-extraction";

/**
 * Resolve an exported Drizzle table by its name in `@/db/schema`.
 *
 * `is(..., PgTable)` rather than a cast: the map's `table` is a plain string,
 * and `schema` also exports enums, relations and row types under names that
 * would pass a `typeof === "object"` check and then produce nonsense SQL.
 */
function resolveTable(name: string): PgTable | undefined {
  const candidate = (schema as Record<string, unknown>)[name];
  return is(candidate, PgTable) ? candidate : undefined;
}

function columnsOf(table: PgTable): Record<string, PgColumn> {
  return getTableColumns(table);
}

/**
 * The single column that addresses one row of this table, as the JS property
 * name the select projection returns it under.
 *
 * Read from the table's declared primary key rather than assumed to be `id`:
 * `lifeInsurancePolicies` — the branch's headline entity — has no `id` at all,
 * its primary key IS `accountId`. A loader hardcoding `id` would silently
 * return nothing for it, and every extracted policy would look brand new.
 */
function primaryKeyOf(entity: DetailEntity, table: PgTable): string {
  const keys = Object.entries(columnsOf(table))
    .filter(([, column]) => column.primary)
    .map(([key]) => key);
  if (keys.length !== 1) {
    throw new Error(
      `${entity.id}: ${entity.table} has ${keys.length} single-column primary key(s); ` +
        "a row that cannot be addressed by one id cannot be matched",
    );
  }
  return keys[0];
}

/**
 * Load the client's existing rows for one entity, across every scenario.
 *
 * Generic on purpose: the Drizzle table is resolved by the map's `table` name
 * rather than a switch on entity id, so adding an extractable entity needs no
 * loader.
 *
 * FAILS CLOSED. Every path that cannot be scoped to the client throws; none
 * returns `[]`. The two are not interchangeable here — an empty array reads as
 * "this client has no policies", which would mark every extracted row `new` and
 * quietly duplicate the client's data. And the failure this guards against is
 * worse than a 500: `lifeInsurancePolicies` has no `clientId`, so a loader that
 * filtered on one it does not have — or fell back to an unfiltered read — would
 * hand back every firm's policies. A cross-tenant leak, not an error.
 *
 * `entity.scopePath` is the declaration, but it is not taken on trust: Task 2's
 * conformance test only asserts a `{ via: "column" }` entity HAS a scopePath,
 * never that its table actually carries a `clientId`. So the column branch
 * re-checks the column exists and refuses the read when it does not.
 *
 * SCENARIO-BLIND, DELIBERATELY AND NARROWLY. A `scopePath` reaches a CLIENT; it
 * says nothing about a scenario, and neither does this function's signature.
 * `accounts.scenarioId` is `notNull`, so the join path returns the entity's rows
 * across EVERY scenario the client has, not just the open one. That is stated
 * here rather than promised away, because there is no scenario id to filter on:
 * `runMapEntityPass` takes none and `clientImports.scenarioId` is nullable.
 *
 * It is safe for exactly one reason, and the reason is checked rather than
 * assumed. Extra rows can only do damage by producing a WRONG `exact` match,
 * and `matchByIdentity` reads no existing row at all unless the entity declares
 * a non-empty `identity` (`matcher.ts:36`). So an entity that is both
 * `scenarioScoped` AND identity-matched is refused outright — for every other
 * entity the extra rows are inert. Today `life_insurance_policy` is scenario
 * scoped with no identity and `disability_policy` is identity-matched but not
 * scenario scoped, so neither is refused; the rule is written against the flags,
 * not against either entity's name, so a third entity gets caught on arrival.
 */
export async function loadExistingRows(args: {
  entity: DetailEntity;
  clientId: string;
}): Promise<ExistingRow[]> {
  const { entity, clientId } = args;

  const path = entity.scopePath;
  if (!path) {
    throw new Error(
      `${entity.id} declares no scopePath, so ${entity.table} cannot be scoped to a client`,
    );
  }

  // A scopePath reaches a client, never a scenario. Rows from the client's other
  // scenarios are harmless to an entity nothing identity-matches, and a wrong
  // `exact` — which Task 14 would then UPDATE — to one that does.
  if (entity.scenarioScoped && (entity.identity?.length ?? 0) > 0) {
    throw new Error(
      `${entity.id} is scenarioScoped and identity-matched, but a scopePath reaches only a ` +
        "client; matching against every scenario's rows could produce a wrong exact match",
    );
  }

  const table = resolveTable(entity.table);
  if (!table) {
    throw new Error(`${entity.id} names table "${entity.table}", which is not a table in @/db/schema`);
  }

  const columns = columnsOf(table);
  const idKey = primaryKeyOf(entity, table);

  let rows: Array<Record<string, unknown>>;

  if (path.via === "column") {
    const clientIdColumn = columns.clientId;
    if (!clientIdColumn) {
      throw new Error(
        `${entity.id} declares scopePath { via: "column" }, but ${entity.table} has no clientId column`,
      );
    }
    rows = await db.select(columns).from(table).where(eq(clientIdColumn, clientId));
  } else {
    const through = resolveTable(path.through);
    if (!through) {
      throw new Error(
        `${entity.id} joins through "${path.through}", which is not a table in @/db/schema`,
      );
    }
    const throughColumns = columnsOf(through);
    const parentId = throughColumns.id;
    const parentClientId = throughColumns.clientId;
    if (!parentId || !parentClientId) {
      throw new Error(
        `${entity.id} joins through "${path.through}", which has no id/clientId to scope by`,
      );
    }
    const joinColumn = columns[path.on];
    if (!joinColumn) {
      throw new Error(
        `${entity.id} joins on "${path.on}", which is not a column on ${entity.table}`,
      );
    }
    rows = await db
      .select(columns)
      .from(table)
      .innerJoin(through, eq(joinColumn, parentId))
      .where(eq(parentClientId, clientId));
  }

  return rows.map((row) => ({ id: String(row[idKey]), values: row }));
}
