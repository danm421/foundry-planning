// Year-range filtering shared across drill-down pages. Mirrors the logic in
// pages/cash-flow/view-model.ts — drill pages and the parent cash-flow page
// stay in lockstep about which years a "Retirement only" or "Lifetime" range
// covers.

import type { ClientData, ClientInfo, ProjectionYear } from "@/engine/types";

export type RangeOption =
  | "retirement"
  | "lifetime"
  | { startYear: number; endYear: number };

export function filterYearsToRange(
  years: ProjectionYear[],
  clientData: ClientData,
  range: RangeOption,
): ProjectionYear[] {
  if (range === "lifetime") return years;
  if (typeof range === "object") {
    return years.filter(
      (y) => y.year >= range.startYear && y.year <= range.endYear,
    );
  }
  const firstRetirementYear = computeFirstRetirementYear(clientData.client);
  if (firstRetirementYear == null) return years;
  return years.filter((y) => y.year >= firstRetirementYear);
}

export function computeFirstRetirementYear(client: ClientInfo): number | null {
  const candidates: number[] = [];
  if (client.dateOfBirth && client.retirementAge != null) {
    candidates.push(
      new Date(client.dateOfBirth).getUTCFullYear() + client.retirementAge,
    );
  }
  if (client.spouseDob && client.spouseRetirementAge != null) {
    candidates.push(
      new Date(client.spouseDob).getUTCFullYear() + client.spouseRetirementAge,
    );
  }
  return candidates.length ? Math.min(...candidates) : null;
}
