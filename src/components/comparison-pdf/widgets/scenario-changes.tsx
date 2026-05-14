// src/components/comparison-pdf/widgets/scenario-changes.tsx
//
// PDF renderer for the "scenario-changes" comparison widget. Iterates over
// each plan that has `panelData` (baseline plans have `null` and are skipped),
// builds ChangeUnit[] from the plan's changes + toggleGroups using the same
// logic as the screen <ScenarioChangesComparisonSection>, and renders each
// unit as a compact row with an op-type badge and a deterministic text
// description via `describeChangeUnit`.
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "@/components/pdf/theme";
import {
  describeChangeUnit,
  type ChangeUnit,
} from "@/lib/comparison/scenario-change-describe";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { McSharedResult } from "@/lib/comparison/widgets/types";
import type { CellSpan, YearRange } from "@/lib/comparison/layout-schema";
import type { BrandingResolved } from "@/lib/comparison-pdf/branding";
import type { ComparisonChangesDrawerPlan } from "@/app/(app)/clients/[id]/comparison/comparison-changes-drawer";
import { seriesColor } from "@/lib/comparison/series-palette";

const s = StyleSheet.create({
  wrap: { padding: 6 },
  planBlock: { marginBottom: 10 },
  planHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  planLabel: {
    fontFamily: "Inter",
    fontSize: 10,
    fontWeight: 700,
    color: PDF_THEME.ink,
  },
  changeRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 3,
    paddingLeft: 11,
  },
  badge: {
    fontFamily: "JetBrains Mono",
    fontSize: 8,
    fontWeight: 700,
    width: 12,
    marginRight: 5,
    marginTop: 1,
  },
  changeText: {
    fontFamily: "Inter",
    fontSize: 9,
    color: PDF_THEME.ink2,
    flex: 1,
  },
  empty: {
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    color: PDF_THEME.ink3,
    paddingLeft: 11,
  },
});

const SPAN_WIDTH: Record<CellSpan, string> = {
  1: "20%",
  2: "40%",
  3: "60%",
  4: "80%",
  5: "100%",
};

interface Props {
  config: unknown;
  plans: ComparisonPlan[];
  mc: McSharedResult | null;
  yearRange: YearRange | null;
  span: CellSpan;
  branding: BrandingResolved;
}

/** Mirror of the screen widget's `unitsFromPanel`. */
function unitsFromPanel(panel: ComparisonChangesDrawerPlan): ChangeUnit[] {
  const grouped = new Map<string, typeof panel.changes>();
  for (const c of panel.changes) {
    if (c.toggleGroupId) {
      const arr = grouped.get(c.toggleGroupId) ?? [];
      arr.push(c);
      grouped.set(c.toggleGroupId, arr);
    }
  }
  const ungrouped = panel.changes.filter((c) => !c.toggleGroupId);

  const units: ChangeUnit[] = [];
  for (const g of panel.toggleGroups) {
    const changes = grouped.get(g.id) ?? [];
    if (changes.length === 0) continue;
    units.push({ kind: "group", groupName: g.name, changes });
  }
  for (const c of ungrouped) {
    units.push({ kind: "single", change: c });
  }
  return units;
}

type OpType = "add" | "edit" | "remove";

function unitOpType(unit: ChangeUnit): OpType {
  if (unit.kind === "group") {
    const ops = new Set(unit.changes.map((c) => c.opType));
    return ops.size === 1 ? unit.changes[0].opType : "edit";
  }
  return unit.change.opType;
}

function badgeStyle(op: OpType): { sign: string; color: string } {
  if (op === "add") return { sign: "+", color: "#34d399" }; // emerald-400
  if (op === "remove") return { sign: "−", color: "#f87171" }; // red-400
  return { sign: "~", color: "#fbbf24" }; // amber-400
}

export function ScenarioChangesPdf({ plans, span }: Props) {
  // Only render plans that have panelData (scenarios); skip baseline nulls.
  const scenarioPlans = plans
    .map((p, i) => ({ plan: p, idx: i }))
    .filter(({ plan }) => plan.panelData != null);

  return (
    <View style={{ ...s.wrap, width: SPAN_WIDTH[span] }}>
      {scenarioPlans.map(({ plan, idx }) => {
        const panel = plan.panelData!;
        const units = unitsFromPanel(panel);
        const dotColor = seriesColor(idx) ?? PDF_THEME.ink3;

        return (
          <View key={plan.id} style={s.planBlock}>
            {/* Plan header: colored dot + label */}
            <View style={s.planHeader}>
              <View style={{ ...s.dot, backgroundColor: dotColor }} />
              <Text style={s.planLabel}>{plan.label}</Text>
            </View>

            {units.length === 0 ? (
              <Text style={s.empty}>No changes recorded.</Text>
            ) : (
              units.map((unit, i) => {
                const op = unitOpType(unit);
                const { sign, color } = badgeStyle(op);
                const title =
                  unit.kind === "group"
                    ? unit.groupName
                    : (panel.targetNames[
                        `${unit.change.targetKind}:${unit.change.targetId}`
                      ] ?? unit.change.targetKind);
                const description = describeChangeUnit(unit, panel.targetNames);
                return (
                  <View
                    key={unit.kind === "single" ? unit.change.id : `g-${i}`}
                    style={s.changeRow}
                  >
                    <Text style={{ ...s.badge, color }}>{sign}</Text>
                    <Text style={s.changeText}>
                      {title !== description.replace(/^(Added|Removed|Edited): /, "").replace(/\.$/, "")
                        ? `${title} — ${description}`
                        : description}
                    </Text>
                  </View>
                );
              })
            )}
          </View>
        );
      })}
    </View>
  );
}
