// src/components/reports/widget-inspectors/monte-carlo-fan.tsx
//
// Inspector body for the monteCarloFan widget. A·Content (title +
// subtitle), B·Data (year range + scenario placeholder — same "coming
// soon" pattern as netWorthLine), C·Display (band picker + headline
// toggle), D·Notes.
//
// Why an inline band picker instead of `InspectorPillMulti`:
// `PercentileBand` is a numeric-literal union (5 | 25 | 50 | 75 | 95) and
// `InspectorPillMulti<T extends string>` is intentionally constrained to
// strings. We could stringify-and-back, but it's lossier than just
// repeating the pill markup with numeric values. If a third numeric-pick
// widget shows up, lift this into an `InspectorPillMultiNumeric`
// primitive — logged in future-work/ui.md.

import { InspectorSection } from "../inspector/section";
import { InspectorTextInput } from "../inspector/text-input";
import { InspectorYearRange } from "../inspector/year-range";
import { InspectorToggle } from "../inspector/toggle";
import { InspectorNotes } from "../inspector/notes";
import { fieldLabelClassName } from "@/components/forms/input-styles";
import type { WidgetInspectorProps } from "@/lib/reports/widget-registry";
import type { PercentileBand } from "@/lib/reports/types";

const BANDS: readonly PercentileBand[] = [5, 25, 50, 75, 95];

export function MonteCarloFanInspector({
  props,
  onChange,
}: WidgetInspectorProps<"monteCarloFan">) {
  return (
    <>
      <InspectorSection eyebrow="A · Content">
        <InspectorTextInput
          label="Title"
          value={props.title}
          onChange={(v) => onChange({ ...props, title: v })}
        />
        <InspectorTextInput
          label="Subtitle"
          value={props.subtitle ?? ""}
          onChange={(v) => onChange({ ...props, subtitle: v || undefined })}
        />
      </InspectorSection>
      <InspectorSection eyebrow="B · Data">
        <InspectorYearRange
          label="Year range"
          value={props.yearRange}
          onChange={(v) => onChange({ ...props, yearRange: v })}
        />
        <div className="text-ink-3 text-[12px]">
          Scenario comparison coming soon.
        </div>
      </InspectorSection>
      <InspectorSection eyebrow="C · Display">
        <div>
          <label className={fieldLabelClassName}>Bands</label>
          <div className="flex flex-wrap gap-1.5">
            {BANDS.map((b) => {
              const on = props.bands.includes(b);
              return (
                <button
                  key={b}
                  type="button"
                  onClick={() =>
                    onChange({
                      ...props,
                      bands: on
                        ? props.bands.filter((x) => x !== b)
                        : [...props.bands, b],
                    })
                  }
                  className={`h-7 px-2.5 rounded-full text-[12px] border transition ${
                    on
                      ? "bg-accent text-paper border-accent"
                      : "bg-card-2 text-ink-3 border-hair hover:border-ink-3"
                  }`}
                >
                  P{b}
                </button>
              );
            })}
          </div>
        </div>
        <InspectorToggle
          label="Show headline"
          value={props.showHeadline}
          onChange={(v) => onChange({ ...props, showHeadline: v })}
        />
      </InspectorSection>
      <InspectorNotes
        value={props.notes ?? ""}
        onChange={(v) => onChange({ ...props, notes: v })}
      />
    </>
  );
}
