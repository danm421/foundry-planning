// src/components/comparison-pdf/cell-render.tsx
import type { CellV5, YearRange } from "@/lib/comparison/layout-schema";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { McSharedResult } from "@/lib/comparison/widgets/types";
import type { BrandingResolved } from "@/lib/comparison-pdf/branding";
import { SnapshotCell } from "./snapshot-cell";
import { TextPdf } from "./widgets/text";
import { KpiPdf } from "./widgets/kpi";
import { KpiStripPdf } from "./widgets/kpi-strip";
import { ClientProfilePdf } from "./widgets/client-profile";
import { ScenarioChangesPdf } from "./widgets/scenario-changes";
import { YearByYearPdf } from "./widgets/year-by-year";
import { RmdSchedulePdf } from "./widgets/rmd-schedule";
import { DecadeSummaryPdf } from "./widgets/decade-summary";
import { RothLadderPdf } from "./widgets/roth-ladder";
import { BalanceSheetPdf } from "./widgets/balance-sheet";

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

  if (kind === "text") {
    return (
      <TextPdf
        config={cell.widget.config}
        plans={ctx.plans}
        mc={ctx.mc}
        yearRange={cell.widget.yearRange ?? null}
        span={cell.span}
        branding={ctx.branding}
      />
    );
  }

  if (kind === "kpi") {
    return (
      <KpiPdf
        config={cell.widget.config}
        plans={ctx.plans}
        mc={ctx.mc}
        yearRange={cell.widget.yearRange ?? null}
        span={cell.span}
        branding={ctx.branding}
      />
    );
  }

  if (kind === "kpi-strip") {
    return (
      <KpiStripPdf
        config={cell.widget.config}
        plans={ctx.plans}
        mc={ctx.mc}
        yearRange={cell.widget.yearRange ?? null}
        span={cell.span}
        branding={ctx.branding}
      />
    );
  }

  if (kind === "client-profile") {
    return (
      <ClientProfilePdf
        config={cell.widget.config}
        plans={ctx.plans}
        mc={ctx.mc}
        yearRange={cell.widget.yearRange ?? null}
        span={cell.span}
        branding={ctx.branding}
      />
    );
  }

  if (kind === "scenario-changes") {
    return (
      <ScenarioChangesPdf
        config={cell.widget.config}
        plans={ctx.plans}
        mc={ctx.mc}
        yearRange={cell.widget.yearRange ?? null}
        span={cell.span}
        branding={ctx.branding}
      />
    );
  }

  if (kind === "year-by-year") {
    return (
      <YearByYearPdf
        config={cell.widget.config}
        plans={ctx.plans}
        mc={ctx.mc}
        yearRange={cell.widget.yearRange ?? null}
        span={cell.span}
        branding={ctx.branding}
      />
    );
  }

  if (kind === "rmd-schedule") {
    return (
      <RmdSchedulePdf
        config={cell.widget.config}
        plans={ctx.plans}
        mc={ctx.mc}
        yearRange={cell.widget.yearRange ?? null}
        span={cell.span}
        branding={ctx.branding}
      />
    );
  }

  if (kind === "decade-summary") {
    return (
      <DecadeSummaryPdf
        config={cell.widget.config}
        plans={ctx.plans}
        mc={ctx.mc}
        yearRange={cell.widget.yearRange ?? null}
        span={cell.span}
        branding={ctx.branding}
      />
    );
  }

  if (kind === "roth-ladder") {
    return (
      <RothLadderPdf
        config={cell.widget.config}
        plans={ctx.plans}
        mc={ctx.mc}
        yearRange={cell.widget.yearRange ?? null}
        span={cell.span}
        branding={ctx.branding}
      />
    );
  }

  if (kind === "balance-sheet") {
    return (
      <BalanceSheetPdf
        config={cell.widget.config}
        plans={ctx.plans}
        mc={ctx.mc}
        yearRange={cell.widget.yearRange ?? null}
        span={cell.span}
        branding={ctx.branding}
      />
    );
  }

  // Native renderers for remaining kinds are wired in subsequent buckets;
  // for now every other kind falls through to the snapshot cell.
  void kind;
  void ctx.plans;
  void ctx.mc;
  void ctx.branding;
  return (
    <SnapshotCell pngDataUrl={ctx.chartImages[cell.id] ?? null} span={cell.span} />
  );
}

export type { YearRange };
