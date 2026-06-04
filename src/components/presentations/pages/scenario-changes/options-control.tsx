"use client";

import type { ScenarioChangesOptions } from "@/lib/presentations/pages/scenario-changes/types";
import {
  OptionsRow,
  OptionsGroup,
} from "@/components/presentations/shared/options-layout";

interface Props {
  value: ScenarioChangesOptions;
  onChange: (next: ScenarioChangesOptions) => void;
}

export function ScenarioChangesOptionsControl({ value, onChange }: Props) {
  return (
    <OptionsRow>
      <OptionsGroup label="Title">
        <input
          type="text"
          aria-label="Page title"
          className="w-full rounded border border-hair bg-card-2 px-2 py-1 text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
        />
      </OptionsGroup>
      <OptionsGroup label="Display">
        <label className="flex items-center gap-2 hover:text-ink">
          <input
            type="checkbox"
            className="accent-accent"
            checked={value.showExplanations}
            onChange={(e) => onChange({ ...value, showExplanations: e.target.checked })}
          />
          <span>Show &ldquo;Why it matters&rdquo; column</span>
        </label>
      </OptionsGroup>
    </OptionsRow>
  );
}
