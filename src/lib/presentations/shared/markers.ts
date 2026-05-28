// Retirement / end-of-life markers shared across drill-down pages. Mirrors
// the buildMarkers + collapseJointMarkers logic in pages/cash-flow/view-model.ts.

import type { ClientData, ProjectionYear } from "@/engine/types";
import type { TableMarker } from "../types";

export function buildMarkers(
  clientData: ClientData,
  visibleYears: ProjectionYear[],
  clientName: string,
  spouseName: string | null,
): TableMarker[] {
  const minYear = visibleYears[0]?.year ?? -Infinity;
  const maxYear = visibleYears[visibleYears.length - 1]?.year ?? Infinity;
  const ci = clientData.client;

  type Principal = {
    who: "client" | "spouse";
    name: string;
    yob: number | null;
    retirementAge: number | null;
    lifeExpectancyOrPlanEnd: number | null;
  };

  const principals: Principal[] = [];
  if (ci.dateOfBirth) {
    principals.push({
      who: "client",
      name: clientName,
      yob: new Date(ci.dateOfBirth).getUTCFullYear(),
      retirementAge: ci.retirementAge ?? null,
      lifeExpectancyOrPlanEnd: ci.lifeExpectancy ?? ci.planEndAge ?? null,
    });
  }
  if (ci.spouseDob) {
    principals.push({
      who: "spouse",
      name: spouseName ?? ci.spouseName ?? "Spouse",
      yob: new Date(ci.spouseDob).getUTCFullYear(),
      retirementAge: ci.spouseRetirementAge ?? null,
      lifeExpectancyOrPlanEnd: ci.spouseLifeExpectancy ?? ci.planEndAge ?? null,
    });
  }

  const markers: TableMarker[] = [];
  for (const p of principals) {
    if (p.yob == null) continue;
    if (p.retirementAge != null) {
      const y = p.yob + p.retirementAge;
      if (y >= minYear && y <= maxYear) {
        markers.push({
          year: y,
          kind: "retirement",
          who: p.who,
          label: `${p.name} — Retirement`,
        });
      }
    }
    if (p.lifeExpectancyOrPlanEnd != null) {
      const y = p.yob + p.lifeExpectancyOrPlanEnd;
      if (y >= minYear && y <= maxYear) {
        markers.push({
          year: y,
          kind: "endOfLife",
          who: p.who,
          label: `${p.name} — End of Life`,
        });
      }
    }
  }
  return collapseJointMarkers(
    markers,
    clientName,
    spouseName ?? ci.spouseName ?? "Spouse",
  );
}

function collapseJointMarkers(
  markers: TableMarker[],
  clientName: string,
  spouseName: string,
): TableMarker[] {
  const grouped = new Map<string, TableMarker[]>();
  for (const m of markers) {
    const k = `${m.year}|${m.kind}`;
    const list = grouped.get(k) ?? [];
    list.push(m);
    grouped.set(k, list);
  }
  const result: TableMarker[] = [];
  for (const list of grouped.values()) {
    if (list.length >= 2) {
      const joint = list[0];
      result.push({
        ...joint,
        who: "joint",
        label: `${clientName} & ${spouseName} — ${
          joint.kind === "retirement" ? "Retirement" : "End of Life"
        }`,
      });
    } else {
      result.push(...list);
    }
  }
  return result.sort((a, b) => a.year - b.year);
}
