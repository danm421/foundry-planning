"use client";

import type { CoverPageOptions } from "@/lib/presentations/types";
import {
  OptionsRow,
  OptionsGroup,
} from "@/components/presentations/shared/options-layout";

interface Props {
  value: CoverPageOptions;
  onChange: (next: CoverPageOptions) => void;
}

export function CoverOptionsControl({ value, onChange }: Props) {
  return (
    <OptionsRow>
      <OptionsGroup label="Title">
        <input
          type="text"
          aria-label="Cover title"
          value={value.title}
          maxLength={120}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
          placeholder="(no title)"
          className="rounded border border-hair bg-card-2 px-2 py-1.5 text-sm text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
        />
      </OptionsGroup>
    </OptionsRow>
  );
}
