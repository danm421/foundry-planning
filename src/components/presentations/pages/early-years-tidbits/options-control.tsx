"use client";

import { OptionsRow, OptionsGroup } from "@/components/presentations/shared/options-layout";
import { TidbitPicker } from "@/components/presentations/shared/tidbit-picker";
import {
  EARLY_YEARS_TIDBITS_OPTIONS_DEFAULT,
  TIDBITS_PAGE_MAX,
  type EarlyYearsTidbitsPageOptions,
} from "@/lib/presentations/pages/early-years-tidbits/types";

interface Props {
  value: EarlyYearsTidbitsPageOptions;
  onChange: (next: EarlyYearsTidbitsPageOptions) => void;
}

export function EarlyYearsTidbitsOptionsControl({ value, onChange }: Props) {
  return (
    <OptionsRow>
      <OptionsGroup label="Tidbits">
        {/* Six, not the sidebar's two — and they are the page here, so the
            picker's default "beside the chart" tail would be false. */}
        <TidbitPicker
          max={TIDBITS_PAGE_MAX}
          hint="they fill this page, two to a row."
          value={value.tidbits}
          defaults={EARLY_YEARS_TIDBITS_OPTIONS_DEFAULT.tidbits}
          onChange={(tidbits) => onChange({ ...value, tidbits })}
        />
      </OptionsGroup>
    </OptionsRow>
  );
}
