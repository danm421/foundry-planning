"use client";

import * as Slider from "@radix-ui/react-slider";
import {
  computePresets,
  isPresetActive,
  clampRange,
  computeAxisLabels,
  type PresetWindows,
} from "./year-range-utils";

interface YearRangeSliderProps {
  min: number;
  max: number;
  value: [number, number];
  onChange: (next: [number, number]) => void;
  clientRetirementYear: number | null;
}

export function YearRangeSlider({
  min,
  max,
  value,
  onChange,
  clientRetirementYear,
}: YearRangeSliderProps) {
  const presets = computePresets(min, max, clientRetirementYear);
  const axisLabels = computeAxisLabels(min, max);
  const disabled = min === max;

  function applyPreset(preset: [number, number] | null) {
    if (preset === null) return;
    onChange(clampRange(preset, min, max));
  }

  return (
    <div className="space-y-3 rounded-lg border border-gray-800 bg-gray-900/40 p-4">
      {/* Preset buttons */}
      <div className="flex items-center gap-2">
        <PresetButton
          label="Full"
          active={isPresetActive(value, presets.full)}
          onClick={() => applyPreset(presets.full)}
        />
        <PresetButton
          label="Working Years"
          active={isPresetActive(value, presets.working)}
          disabled={presets.working === null}
          disabledReason="Set client DOB and retirement age to enable"
          onClick={() => applyPreset(presets.working)}
        />
        <PresetButton
          label="Retirement Years"
          active={isPresetActive(value, presets.retirement)}
          disabled={presets.retirement === null}
          disabledReason="Set client DOB and retirement age to enable"
          onClick={() => applyPreset(presets.retirement)}
        />
        <span className="ml-auto text-xs tabular-nums text-gray-400">
          {value[0]}{value[0] !== value[1] ? ` – ${value[1]}` : ""}
        </span>
      </div>

      {/* Slider */}
      <Slider.Root
        className="relative flex h-5 w-full touch-none select-none items-center"
        value={value}
        min={min}
        max={max}
        step={1}
        minStepsBetweenThumbs={0}
        disabled={disabled}
        onValueChange={(next) => {
          if (next.length === 2) {
            onChange(clampRange([next[0], next[1]], min, max));
          }
        }}
        aria-label="Year range"
      >
        <Slider.Track className="relative h-1 w-full grow rounded-full bg-gray-700">
          <Slider.Range className="absolute h-full rounded-full bg-blue-500" />
        </Slider.Track>
        <Slider.Thumb
          className="block h-4 w-4 rounded-full border border-gray-300 bg-white shadow focus:outline-none focus:ring-2 focus:ring-blue-400"
          aria-label="From year"
        />
        <Slider.Thumb
          className="block h-4 w-4 rounded-full border border-gray-300 bg-white shadow focus:outline-none focus:ring-2 focus:ring-blue-400"
          aria-label="To year"
        />
      </Slider.Root>

      {/* Year-label axis */}
      <div className="relative h-4 w-full">
        {axisLabels.map((label, i) => {
          const ratio = max === min ? 0 : (label - min) / (max - min);
          // Convert ratio (0..1) to a left percent; clamp endpoints to keep labels on-screen
          const leftPct = ratio * 100;
          // For the first and last labels, anchor to the side so they don't overflow
          const transform =
            i === 0
              ? "translateX(0)"
              : i === axisLabels.length - 1
                ? "translateX(-100%)"
                : "translateX(-50%)";
          return (
            <span
              key={label}
              className="absolute top-0 text-xs text-gray-500 tabular-nums"
              style={{ left: `${leftPct}%`, transform }}
            >
              {label}
            </span>
          );
        })}
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
      className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
        disabled
          ? "cursor-not-allowed text-gray-600"
          : active
            ? "bg-gray-700 text-white"
            : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
      }`}
    >
      {label}
    </button>
  );
}
