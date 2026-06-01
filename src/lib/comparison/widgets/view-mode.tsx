"use client";

import type { ReactNode } from "react";
import { z } from "zod";

import type { ComparisonWidgetConfigContext } from "./types";

export const ViewModeSchema = z.object({
  viewMode: z.enum(["chart", "chart+table", "table"]),
});
export type ViewModeConfig = z.infer<typeof ViewModeSchema>;
export type ViewMode = ViewModeConfig["viewMode"];

export const defaultViewMode: ViewModeConfig = { viewMode: "chart" };

export function getViewMode(config: unknown): ViewMode {
  const parsed = ViewModeSchema.safeParse(config);
  return parsed.success ? parsed.data.viewMode : "chart";
}

const MODE_BUTTONS: Array<{ value: ViewMode; label: string }> = [
  { value: "chart", label: "Chart" },
  { value: "chart+table", label: "Chart + table" },
  { value: "table", label: "Table only" },
];

export function renderViewModeConfig(
  ctx: ComparisonWidgetConfigContext<ViewModeConfig>,
) {
  const current = getViewMode(ctx.config);
  return (
    <div role="radiogroup" aria-label="View mode" className="flex gap-1">
      {MODE_BUTTONS.map((b) => {
        const active = current === b.value;
        return (
          <button
            key={b.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => ctx.onChange({ viewMode: b.value })}
            className={`rounded border px-2 py-1 text-xs ${
              active
                ? "border-accent bg-accent/10 text-accent"
                : "border-hair text-ink-2 hover:bg-card-hover"
            }`}
          >
            {b.label}
          </button>
        );
      })}
    </div>
  );
}

export function ViewModeFrame({
  mode,
  chart,
  table,
}: {
  mode: ViewMode;
  chart: ReactNode;
  table: ReactNode;
}) {
  if (mode === "chart") return <>{chart}</>;
  if (mode === "table") return <>{table}</>;
  return (
    <div className="flex flex-col gap-3">
      {chart}
      {table}
    </div>
  );
}
