"use client";

import type { YearRange } from "@/lib/comparison/layout-schema";
import {
  computePresets,
  isPresetActive,
  clampRange,
} from "@/components/cashflow/year-range-utils";

interface Props {
  min: number;
  max: number;
  yearRange: YearRange | undefined;
  onChange: (next: YearRange | undefined) => void;
  clientRetirementYear?: number | null;
}

export function PerWidgetYearRange({
  min,
  max,
  yearRange,
  onChange,
  clientRetirementYear = null,
}: Props) {
  const start = yearRange?.start ?? min;
  const end = yearRange?.end ?? max;

  const presets = computePresets(min, max, clientRetirementYear);
  const current: [number, number] = [start, end];
  // "Full" is the implicit default — also active when the range is undefined.
  const fullActive = yearRange === undefined || isPresetActive(current, presets.full);

  const setStart = (v: number) => {
    if (Number.isNaN(v)) return;
    const clamped = Math.min(Math.max(v, min), end);
    onChange({ start: clamped, end });
  };
  const setEnd = (v: number) => {
    if (Number.isNaN(v)) return;
    const clamped = Math.max(Math.min(v, max), start);
    onChange({ start, end: clamped });
  };

  const applyPreset = (preset: [number, number] | null) => {
    if (preset === null) return;
    const [s, e] = clampRange(preset, min, max);
    onChange({ start: s, end: e });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <PresetButton
          label="Full"
          active={fullActive}
          onClick={() => onChange(undefined)}
        />
        <PresetButton
          label="Working"
          active={!fullActive && isPresetActive(current, presets.working)}
          disabled={presets.working === null}
          disabledReason="Set client DOB and retirement age to enable"
          onClick={() => applyPreset(presets.working)}
        />
        <PresetButton
          label="Retirement"
          active={!fullActive && isPresetActive(current, presets.retirement)}
          disabled={presets.retirement === null}
          disabledReason="Set client DOB and retirement age to enable"
          onClick={() => applyPreset(presets.retirement)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
        <label className="flex items-center gap-1">
          Start
          <input
            type="number"
            min={min}
            max={end}
            value={start}
            onChange={(e) => setStart(Number(e.target.value))}
            step={1}
            className="w-16 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-slate-100"
          />
        </label>
        <label className="flex items-center gap-1">
          End
          <input
            type="number"
            min={start}
            max={max}
            value={end}
            onChange={(e) => setEnd(Number(e.target.value))}
            step={1}
            className="w-16 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-slate-100"
          />
        </label>
        {!fullActive && (
          <span className="italic text-ink-3">Custom</span>
        )}
      </div>
    </div>
  );
}

function PresetButton({
  label,
  active,
  disabled = false,
  disabledReason,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      className={`rounded border px-2 py-0.5 text-[11px] transition-colors ${
        disabled
          ? "cursor-not-allowed border-slate-800 text-ink-3"
          : active
            ? "border-amber-400 bg-amber-400/10 text-amber-200"
            : "border-slate-700 text-slate-300 hover:bg-slate-800"
      }`}
    >
      {label}
    </button>
  );
}
