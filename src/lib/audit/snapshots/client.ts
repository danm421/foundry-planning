// src/lib/audit/snapshots/client.ts
import { clients } from "@/db/schema";
import type { EntitySnapshot, FieldLabels } from "../types";

export const CLIENT_FIELD_LABELS: FieldLabels = {
  firstName: { label: "First name", format: "text" },
  lastName: { label: "Last name", format: "text" },
  dateOfBirth: { label: "Date of birth", format: "date" },
  retirementAge: { label: "Retirement age", format: "text" },
  planEndAge: { label: "Plan end age", format: "text" },
  lifeExpectancy: { label: "Life expectancy", format: "text" },
  spouseName: { label: "Spouse first name", format: "text" },
  spouseLastName: { label: "Spouse last name", format: "text" },
  spouseDob: { label: "Spouse date of birth", format: "date" },
  spouseRetirementAge: { label: "Spouse retirement age", format: "text" },
  spouseLifeExpectancy: { label: "Spouse life expectancy", format: "text" },
  filingStatus: { label: "Filing status", format: "text" },
};

type ClientRow = typeof clients.$inferSelect;

/**
 * Snapshot for client identity and plan-horizon fields. PII fields
 * (email/address) are intentionally excluded — see plan §B6.
 */
export function toClientSnapshot(row: ClientRow): EntitySnapshot {
  return {
    firstName: row.firstName,
    lastName: row.lastName,
    dateOfBirth: row.dateOfBirth,
    retirementAge: row.retirementAge,
    planEndAge: row.planEndAge,
    lifeExpectancy: row.lifeExpectancy,
    spouseName: row.spouseName,
    spouseLastName: row.spouseLastName,
    spouseDob: row.spouseDob,
    spouseRetirementAge: row.spouseRetirementAge,
    spouseLifeExpectancy: row.spouseLifeExpectancy,
    filingStatus: row.filingStatus,
  };
}
