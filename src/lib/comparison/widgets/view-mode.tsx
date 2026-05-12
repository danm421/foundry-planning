"use client";

import type { ReactNode } from "react";
import { z } from "zod";

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
