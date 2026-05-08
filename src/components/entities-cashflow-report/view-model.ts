import type { ProjectionYear, EntityCashFlowRow, TrustCashFlowRow, BusinessCashFlowRow } from "@/engine/types";

export interface SelectEntityRowsInput {
  years: ProjectionYear[];
  entityId: string;
  startYear: number;
  endYear: number;
}

export type SelectedRows =
  | { kind: "trust";    rows: TrustCashFlowRow[] }
  | { kind: "business"; rows: BusinessCashFlowRow[] }
  | { kind: "empty";    rows: [] };

export function selectEntityRows(input: SelectEntityRowsInput): SelectedRows {
  const { years, entityId, startYear, endYear } = input;
  const rows: EntityCashFlowRow[] = [];
  for (const y of years) {
    if (y.year < startYear || y.year > endYear) continue;
    const r = y.entityCashFlow.get(entityId);
    if (r) rows.push(r);
  }
  if (rows.length === 0) return { kind: "empty", rows: [] };
  const kind = rows[0].kind;
  if (kind === "trust") return { kind: "trust", rows: rows as TrustCashFlowRow[] };
  return { kind: "business", rows: rows as BusinessCashFlowRow[] };
}
