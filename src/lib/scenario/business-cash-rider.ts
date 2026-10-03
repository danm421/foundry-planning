// src/lib/scenario/business-cash-rider.ts
//
// A business added inside a scenario is saved as TWO `account` add rows: the
// business itself and the "<name> — Cash" checking account it runs its money
// through (business-dialog/details-form.tsx mirrors the child that
// `createAccountForClient` provisions in base). That cash account is the
// business's plumbing, not a change of its own, so it RIDES with its business:
// it takes the business's switch and toggle group wherever changes are read,
// display lists leave it out, and deleting the business deletes it.
//
// A rider is recognised by its payload alone — a default-checking account whose
// parent is the business's id — so legacy rows written before this module
// existed are covered too. The TS and SQL forms below encode that same rule.

import { and, eq, sql, type SQL } from "drizzle-orm";
import { scenarioChanges } from "@/db/schema";

type ChangeShape = { opType: string; targetKind: string; targetId: string; payload: unknown };

function riderParentId(c: ChangeShape): string | null {
  if (c.opType !== "add" || c.targetKind !== "account") return null;
  const p = c.payload as { isDefaultChecking?: unknown; parentAccountId?: unknown } | null;
  if (p?.isDefaultChecking !== true || typeof p.parentAccountId !== "string") return null;
  return p.parentAccountId;
}

function accountAddsById<T extends ChangeShape>(changes: T[]): Map<string, T> {
  return new Map(
    changes
      .filter((c) => c.opType === "add" && c.targetKind === "account")
      .map((c) => [c.targetId, c]),
  );
}

/** Give every rider its business's `enabled` and `toggleGroupId`, so a
 *  business switched off or grouped takes its cash along — whichever writer
 *  moved it. */
export function withRidersFollowingTheirBusiness<
  T extends ChangeShape & { enabled: boolean; toggleGroupId: string | null },
>(changes: T[]): T[] {
  const adds = accountAddsById(changes);
  return changes.map((c) => {
    const parentId = riderParentId(c);
    const business = parentId == null ? undefined : adds.get(parentId);
    return business
      ? { ...c, enabled: business.enabled, toggleGroupId: business.toggleGroupId }
      : c;
  });
}

/** Drop every rider whose business is also added in this list. A rider whose
 *  business is NOT here (orphaned before riders were cascaded) stays visible,
 *  so it can still be deleted. */
export function withoutBusinessCashRiders<T extends ChangeShape>(changes: T[]): T[] {
  const adds = accountAddsById(changes);
  return changes.filter((c) => {
    const parentId = riderParentId(c);
    return parentId == null || !adds.has(parentId);
  });
}

/** WHERE clause matching the rider rows of the business `businessId` in a
 *  scenario. */
export function businessCashRidersOf(scenarioId: string, businessId: string): SQL {
  return and(
    eq(scenarioChanges.scenarioId, scenarioId),
    eq(scenarioChanges.targetKind, "account"),
    eq(scenarioChanges.opType, "add"),
    sql`${scenarioChanges.payload}->>'parentAccountId' = ${businessId}`,
    sql`${scenarioChanges.payload}->'isDefaultChecking' = 'true'::jsonb`,
  )!;
}
