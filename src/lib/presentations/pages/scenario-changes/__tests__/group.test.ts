import { describe, it, expect } from "vitest";
import { groupUnits } from "../group";
import type { ChangeRow } from "../types";
import type { ScenarioChange, ToggleGroup } from "@/engine/scenario/types";

function ch(id: string, toggleGroupId: string | null, orderIndex: number): ScenarioChange {
  return { id, scenarioId: "s", opType: "edit", targetKind: "income", targetId: id, payload: {}, toggleGroupId, orderIndex };
}
function row(area: ChangeRow["area"], what: string): ChangeRow {
  return { area, what, op: "edit", before: "—", after: "—", why: "" };
}

describe("groupUnits", () => {
  it("emits a group unit per toggle group and rows for the rest, in area order", () => {
    const items = [
      { change: ch("a", null, 2), row: row("Expenses", "Living expenses") },
      { change: ch("b", "g1", 0), row: row("Estate", "Trust") },
      { change: ch("c", "g1", 1), row: row("Assets", "Installment sale") },
      { change: ch("d", null, 3), row: row("Income", "Rental income") },
    ];
    const groups: ToggleGroup[] = [
      { id: "g1", scenarioId: "s", name: "IDGT installment sale", defaultOn: true, requiresGroupId: null, orderIndex: 0 },
    ];

    const units = groupUnits(items, groups);

    // Income (d) before Expenses (a) before Estate group (first member area = Assets? no — group sorts by min area)
    const labels = units.map((u) => (u.kind === "group" ? `group:${u.label}` : u.row.what));
    expect(labels).toEqual(["Rental income", "Living expenses", "group:IDGT installment sale"]);

    const group = units.find((u) => u.kind === "group");
    expect(group?.kind === "group" && group.rows.map((r) => r.what)).toEqual(["Trust", "Installment sale"]);
  });

  it("uses a default label when the toggle group has no name", () => {
    const items = [{ change: ch("a", "gX", 0), row: row("Estate", "Thing") }];
    const units = groupUnits(items, []);
    expect(units[0].kind === "group" && units[0].label).toBe("Strategy");
  });
});
