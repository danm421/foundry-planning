// src/lib/audit/snapshots/client.ts
import { clients } from "@/db/schema";
import type { EntitySnapshot, FieldLabels } from "../types";

export const CLIENT_FIELD_LABELS: FieldLabels = {
  retirementAge: { label: "Retirement age", format: "text" },
  retirementMonth: { label: "Retirement month", format: "text" },
  planEndAge: { label: "Plan end age", format: "text" },
  lifeExpectancy: { label: "Life expectancy", format: "text" },
  spouseRetirementAge: { label: "Spouse retirement age", format: "text" },
  spouseRetirementMonth: { label: "Spouse retirement month", format: "text" },
  spouseLifeExpectancy: { label: "Spouse life expectancy", format: "text" },
  filingStatus: { label: "Filing status", format: "text" },
};

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
  };
}
