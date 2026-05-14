// Pure helpers shared between the screen Balance Sheet section and the PDF
// renderer. No React, no Next.js, no UI-only imports.
//
// Source of truth: previously inlined in
// src/components/comparison/balance-sheet-comparison-section.tsx and ported into
// src/components/comparison-pdf/widgets/balance-sheet.tsx. Both now import from
// here (matches the Task 3.2 precedent set by kpi-metric.ts).

import type { EntitySummary, FamilyMember } from "@/engine/types";
import type { AccountOwner } from "@/engine/ownership";

// Column identifiers: per-family-member ids ("fm:<id>"), per-entity ids
// ("ent:<id>"), or the synthetic "joint" bucket for accounts split equally
// between the two household principals.
export type ColumnKey = string;
export const JOINT_COL: ColumnKey = "joint";

export interface ColumnSpec {
  key: ColumnKey;
  label: string;
}

export interface MatrixRow {
  id: string;
  name: string;
  value: number;
  dist: Record<ColumnKey, number>;
}

export function fmt(n: number): string {
  if (!n) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

export function isHouseholdPrincipalSplit(
  owners: AccountOwner[],
  familyById: Map<string, FamilyMember>,
): boolean {
  if (owners.length !== 2) return false;
  const roles = owners
    .filter((o) => o.kind === "family_member")
    .map((o) => (o.kind === "family_member" ? familyById.get(o.familyMemberId)?.role : undefined));
  if (roles.length !== 2) return false;
  return roles.includes("client") && roles.includes("spouse");
}

/** Distribute `value` across columns according to ownership. Single-owner
 *  accounts land entirely in one column; client+spouse splits collapse to the
 *  Joint/ROS column; any other multi-owner shape splits proportionally. */
export function distribute(
  value: number,
  owners: AccountOwner[] | undefined,
  familyById: Map<string, FamilyMember>,
): Record<ColumnKey, number> {
  const out: Record<ColumnKey, number> = {};
  const list = owners ?? [];
  if (list.length === 0 || !value) return out;
  if (list.length === 1 && (list[0].percent ?? 1) >= 0.999) {
    const o = list[0];
    const key = o.kind === "entity" ? `ent:${o.entityId}` : `fm:${o.familyMemberId}`;
    out[key] = value;
    return out;
  }
  if (isHouseholdPrincipalSplit(list, familyById)) {
    out[JOINT_COL] = value;
    return out;
  }
  for (const o of list) {
    const key = o.kind === "entity" ? `ent:${o.entityId}` : `fm:${o.familyMemberId}`;
    out[key] = (out[key] ?? 0) + value * (o.percent ?? 0);
  }
  return out;
}

/** Walk all distributions once to discover which columns to render, preserving
 *  a stable order: client → spouse → Joint/ROS → other family members →
 *  entities. Columns with zero contribution across every row are dropped. */
export function buildColumns(
  dists: Array<Record<ColumnKey, number>>,
  familyMembers: FamilyMember[],
  entities: EntitySummary[],
): ColumnSpec[] {
  const used = new Set<ColumnKey>();
  for (const dist of dists) {
    for (const [k, v] of Object.entries(dist)) {
      if (v) used.add(k);
    }
  }
  const cols: ColumnSpec[] = [];
  const byRole = (role: FamilyMember["role"]) => familyMembers.find((fm) => fm.role === role);
  const client = byRole("client");
  const spouse = byRole("spouse");
  if (client && used.has(`fm:${client.id}`)) {
    cols.push({ key: `fm:${client.id}`, label: client.firstName || "Client" });
  }
  if (spouse && used.has(`fm:${spouse.id}`)) {
    cols.push({ key: `fm:${spouse.id}`, label: spouse.firstName || "Spouse" });
  }
  if (used.has(JOINT_COL)) cols.push({ key: JOINT_COL, label: "Joint/ROS" });
  for (const fm of familyMembers) {
    if (fm.role === "client" || fm.role === "spouse") continue;
    if (used.has(`fm:${fm.id}`)) {
      cols.push({ key: `fm:${fm.id}`, label: fm.firstName || fm.role });
    }
  }
  for (const e of entities) {
    if (used.has(`ent:${e.id}`)) {
      cols.push({ key: `ent:${e.id}`, label: e.name ?? "Entity" });
    }
  }
  return cols;
}
