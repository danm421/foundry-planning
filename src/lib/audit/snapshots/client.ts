// src/lib/audit/snapshots/client.ts
import "server-only";
import { clients } from "@/db/schema";
import type { EntitySnapshot } from "../types";

// Labels live in the server-free `../field-labels` (audit F3); re-exported
// here so server callers keep one import site.
export { CLIENT_FIELD_LABELS } from "../field-labels";

type ClientRow = typeof clients.$inferSelect;

/**
 * Snapshot for planning fields on the clients row. Identity (first/last name,
 * DOB, spouse identity, email/address) now lives on CRM contacts — audited
 * separately via crm.contact.update events.
 */
export function toClientSnapshot(row: ClientRow): EntitySnapshot {
  return {
    retirementAge: row.retirementAge,
    retirementMonth: row.retirementMonth,
    planEndAge: row.planEndAge,
    lifeExpectancy: row.lifeExpectancy,
    spouseRetirementAge: row.spouseRetirementAge,
    spouseRetirementMonth: row.spouseRetirementMonth,
    spouseLifeExpectancy: row.spouseLifeExpectancy,
    filingStatus: row.filingStatus,
    riskTolerance: row.riskTolerance,
  };
}
