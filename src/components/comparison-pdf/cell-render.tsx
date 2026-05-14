// src/components/comparison-pdf/cell-render.tsx
import type { CellV5, YearRange } from "@/lib/comparison/layout-schema";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { McSharedResult } from "@/lib/comparison/widgets/types";
import type { BrandingResolved } from "@/lib/comparison-pdf/branding";
import { SnapshotCell } from "./snapshot-cell";

export interface CellRenderCtx {
  plans: ComparisonPlan[];
  mc: McSharedResult | null;
  branding: BrandingResolved;
  chartImages: Record<string, string>;
}

export interface CellRenderProps {
  cell: CellV5;
  ctx: CellRenderCtx;
}

export function CellRender({ cell, ctx }: CellRenderProps) {
  if (!cell.widget) return null;
  const kind = cell.widget.kind;
  // Native renderers are wired in subsequent buckets; for now every kind
  // falls through to the snapshot cell.
  void kind;
  void ctx.plans;
  void ctx.mc;
  void ctx.branding;
  return (
    <SnapshotCell pngDataUrl={ctx.chartImages[cell.id] ?? null} span={cell.span} />
  );
}

export type { YearRange };
