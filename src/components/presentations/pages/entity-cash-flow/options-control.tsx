"use client";

import { useEffect } from "react";
import type { EntityCashFlowPageOptions } from "./types";
import { useEntityOptions } from "@/components/presentations/options-context";
import { OptionsRow, OptionsGroup } from "@/components/presentations/shared/options-layout";
import { YearRangeControl } from "@/components/presentations/shared/year-range-control";

interface Props {
  value: EntityCashFlowPageOptions;
  onChange: (next: EntityCashFlowPageOptions) => void;
}

const field =
  "rounded border border-hair bg-card-2 px-2 py-1 text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40";

export function EntityCashFlowOptionsControl({ value, onChange }: Props) {
  const entities = useEntityOptions();
  const trusts = entities.filter((e) => e.entityType === "trust");
  const businesses = entities.filter((e) => e.entityType !== "trust");

  // Mirror the in-app default (selectedEntityId = entities[0]?.id): when no
  // entity is chosen yet, pre-select the first so a freshly added page renders.
  // Deps intentionally exclude `onChange` (a fresh arrow each parent render) and
  // the full `value` object — the body only runs while no entity is selected, so
  // re-firing on unrelated re-renders would be wasted work.
  useEffect(() => {
    if (!value.entityId && entities.length > 0) {
      const first = entities[0];
      onChange({ ...value, entityId: first.id, entityName: first.name });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.entityId, entities]);

  if (entities.length === 0) {
    return (
      <OptionsRow>
        <span className="text-sm text-ink-3">No trusts or businesses on file.</span>
      </OptionsRow>
    );
  }

  return (
    <OptionsRow>
      <OptionsGroup label="Entity">
        <select
          aria-label="Entity"
          className={field}
          value={value.entityId}
          onChange={(e) => {
            const ent = entities.find((x) => x.id === e.target.value);
            onChange({ ...value, entityId: e.target.value, entityName: ent?.name ?? "" });
          }}
        >
          {trusts.length > 0 && (
            <optgroup label="Trusts">
              {trusts.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </optgroup>
          )}
          {businesses.length > 0 && (
            <optgroup label="Businesses">
              {businesses.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </optgroup>
          )}
        </select>
      </OptionsGroup>
      <YearRangeControl
        value={value.range}
        onChange={(range) => onChange({ ...value, range })}
      />
    </OptionsRow>
  );
}
