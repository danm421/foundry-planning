// src/lib/audit/snapshots/roth-conversion.ts
import { db } from "@/db";
import { accounts, rothConversions } from "@/db/schema";
import { inArray } from "drizzle-orm";
import type { EntitySnapshot, FieldLabels, ReferenceValue } from "../types";

export const ROTH_CONVERSION_FIELD_LABELS: FieldLabels = {
  name: { label: "Name", format: "text" },
  destinationAccount: { label: "Destination account", format: "reference" },
  conversionType: { label: "Conversion type", format: "text" },
  fixedAmount: { label: "Fixed amount", format: "currency" },
  fillUpBracket: { label: "Fill-up bracket", format: "percent" },
  startYear: { label: "Start year", format: "text" },
  startYearRef: { label: "Start year ref", format: "text" },
  endYear: { label: "End year", format: "text" },
  endYearRef: { label: "End year ref", format: "text" },
  indexingRate: { label: "Indexing rate", format: "percent" },
  inflationStartYear: { label: "Indexing starts", format: "text" },
};

type RothConversionRow = typeof rothConversions.$inferSelect;

export async function toRothConversionSnapshot(
  row: RothConversionRow,
): Promise<EntitySnapshot> {
  const accountRows = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(inArray(accounts.id, [row.destinationAccountId]));
  const map = new Map(accountRows.map((r) => [r.id, r.name]));

  const ref = (id: string): ReferenceValue => ({
    id,
    display: map.get(id) ?? "(deleted)",
  });

  return {
    name: row.name,
    destinationAccount: ref(row.destinationAccountId),
    conversionType: row.conversionType,
    fixedAmount: Number(row.fixedAmount),
    fillUpBracket: row.fillUpBracket != null ? Number(row.fillUpBracket) : null,
    startYear: row.startYear,
    startYearRef: row.startYearRef,
    endYear: row.endYear,
    endYearRef: row.endYearRef,
    indexingRate: Number(row.indexingRate),
    inflationStartYear: row.inflationStartYear,
  };
}
