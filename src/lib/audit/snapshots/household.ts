import "server-only";
import { crmHouseholds } from "@/db/schema";
import type { EntitySnapshot } from "../types";

type CrmHouseholdRow = typeof crmHouseholds.$inferSelect;

/**
 * Snapshot of the human-meaningful household fields, captured before a
 * permanent purge so the audit row stays readable after the row is gone.
 */
export function toHouseholdSnapshot(row: CrmHouseholdRow): EntitySnapshot {
  return {
    name: row.name,
    status: row.status,
    advisorId: row.advisorId,
    notes: row.notes ?? null,
  };
}
