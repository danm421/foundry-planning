// src/engine/scenario/applyChanges.ts
import type { ToggleGroup, ToggleState } from "./types";

export function resolveEffectiveToggleState(
  toggleState: ToggleState,
  groups: ToggleGroup[],
): ToggleState {
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const effective: ToggleState = {};

  for (const group of groups) {
    const explicit = toggleState[group.id] ?? group.defaultOn;
    if (group.requiresGroupId == null) {
      effective[group.id] = explicit;
    } else {
      const parent = groupById.get(group.requiresGroupId);
      const parentEffective =
        parent != null
          ? (toggleState[parent.id] ?? parent.defaultOn)
          : true;
      effective[group.id] = explicit && parentEffective;
    }
  }

  return effective;
}
