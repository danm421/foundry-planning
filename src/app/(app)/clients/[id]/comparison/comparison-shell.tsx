"use client";

import { useEffect, useMemo } from "react";
import type {
  ComparisonLayout,
  YearRange,
} from "@/lib/comparison/layout-schema";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import { COMPARISON_WIDGETS } from "@/lib/comparison/widgets/registry";
import { useLayout } from "./use-layout";
import { useSharedMcRun } from "./use-shared-mc-run";
import { WidgetRenderer } from "./widget-renderer";
import { WidgetPanel } from "./widget-panel";

interface Props {
  clientId: string;
  plans: ComparisonPlan[];
  initialLayout: ComparisonLayout;
  /** True while the right-side Widget panel is open. */
  panelOpen: boolean;
  onClosePanel: () => void;
  yearRange: YearRange | null;
}

export function ComparisonShell({
  clientId,
  plans,
  initialLayout,
  panelOpen,
  onClosePanel,
  yearRange,
}: Props) {
  const api = useLayout(initialLayout, clientId);
  const layout = api.layout;
  const { setYearRange } = api;

  // Mirror the page-owned yearRange into the saved-layout state so panel-Done
  // saves include the current slider value. setYearRange has a same-value
  // bail-out, so this is safe to fire each render.
  useEffect(() => {
    setYearRange(yearRange);
  }, [yearRange, setYearRange]);

  const mcEnabled = useMemo(
    () => layout.items.some((i) => COMPARISON_WIDGETS[i.kind].needsMc),
    [layout.items],
  );

  const mcState = useSharedMcRun({
    clientId,
    plans,
    enabled: mcEnabled,
  });
  const mc = mcState.status === "ready" ? mcState.result ?? null : null;

  const isLive =
    plans.length >= 2 && plans.some((p, i) => i > 0 && p.id !== plans[0].id);

  if (!isLive && !panelOpen) {
    return (
      <div className="px-6 py-16 text-center text-slate-400">
        Pick a second plan to see the comparison.
      </div>
    );
  }

  const handleDone = async () => {
    try {
      await api.save();
    } catch (e) {
      console.error("[comparison-layout] save failed:", e);
    } finally {
      onClosePanel();
    }
  };

  return (
    <>
      <WidgetRenderer
        layout={layout}
        clientId={clientId}
        plans={plans}
        mc={mc}
        yearRange={yearRange}
        editing={panelOpen}
        onTextChange={api.updateTextMarkdown}
      />
      {panelOpen && (
        <WidgetPanel
          layout={layout}
          api={api}
          onDone={handleDone}
        />
      )}
    </>
  );
}
