"use client";

import { OptionsRow, OptionsGroup } from "@/components/presentations/shared/options-layout";
import { TidbitPicker } from "@/components/presentations/shared/tidbit-picker";
import type { EarlyYearsTidbitsPageOptions } from "@/lib/presentations/pages/early-years-tidbits/types";

interface Props {
  value: EarlyYearsTidbitsPageOptions;
  onChange: (next: EarlyYearsTidbitsPageOptions) => void;
}

export function EarlyYearsTidbitsOptionsControl({ value, onChange }: Props) {
  return (
    <OptionsRow>
      <OptionsGroup label="Notes">
        {/* Six, not the sidebar's two — and they are the page here, so the
            picker's default "beside the chart" hint would be false. */}
        <TidbitPicker
          max={6}
          hint="Pick up to 6 — they fill this page, two to a row."
          value={value.tidbits}
          onChange={(tidbits) => onChange({ ...value, tidbits })}
        />
      </OptionsGroup>
    </OptionsRow>
  );
}
