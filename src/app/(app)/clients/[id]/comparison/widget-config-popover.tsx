"use client";

import { useEffect } from "react";
import {
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
} from "@floating-ui/react";
import type { WidgetInstance, YearRange } from "@/lib/comparison/layout-schema";
import { WidgetConfigPanel } from "./widget-config-panel";

interface Props {
  anchor: HTMLElement | null;
  widget: WidgetInstance;
  scenarios: { id: string; name: string }[];
  availableYearRange: { min: number; max: number };
  onChangePlanIds: (planIds: string[]) => void;
  onChangeYearRange: (yearRange: YearRange | undefined) => void;
  onChangeConfig: (config: unknown) => void;
  onClose: () => void;
}

export function WidgetConfigPopover({
  anchor,
  widget,
  scenarios,
  availableYearRange,
  onChangePlanIds,
  onChangeYearRange,
  onChangeConfig,
  onClose,
}: Props) {
  const { refs, floatingStyles, context } = useFloating({
    open: anchor !== null,
    onOpenChange: (open) => { if (!open) onClose(); },
    placement: "right-start",
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const { setReference, setFloating } = refs;

  useEffect(() => {
    setReference(anchor);
  }, [anchor, setReference]);

  const dismiss = useDismiss(context, { outsidePress: true, escapeKey: true });
  const { getFloatingProps } = useInteractions([dismiss]);

  if (!anchor) return null;

  return (
    <div
      ref={setFloating}
      style={floatingStyles}
      role="dialog"
      aria-label="Edit widget"
      className="z-50 w-[360px] rounded-lg border border-slate-700 bg-slate-950 p-3 shadow-xl"
      {...getFloatingProps()}
    >
      <WidgetConfigPanel
        widget={widget}
        scenarios={scenarios}
        availableYearRange={availableYearRange}
        onChangePlanIds={onChangePlanIds}
        onChangeYearRange={onChangeYearRange}
        onChangeConfig={onChangeConfig}
      />
    </div>
  );
}
