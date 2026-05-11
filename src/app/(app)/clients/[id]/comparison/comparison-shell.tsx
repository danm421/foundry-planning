"use client";

import { useMemo } from "react";
import type { ComparisonLayout } from "@/lib/comparison/layout-schema";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import { COMPARISON_WIDGETS } from "@/lib/comparison/widgets/registry";
import { useLayout } from "./use-layout";
import { useSharedMcRun } from "./use-shared-mc-run";
import { WidgetRenderer } from "./widget-renderer";
import { WidgetChrome } from "./widget-chrome";
import { CustomizeToolbar } from "./customize-toolbar";

interface Props {
  clientId: string;
  plans: ComparisonPlan[];
  initialLayout: ComparisonLayout;
  customizing: boolean;
  onExitCustomize: () => void;
}

export function ComparisonShell({
  clientId,
  plans,
  initialLayout,
  customizing,
  onExitCustomize,
}: Props) {
  const api = useLayout(initialLayout, clientId);
  const layout = api.layout;

  const mcEnabled = useMemo(() => {
    return layout.items.some((i) => {
      if (i.hidden || i.collapsed) return false;
      return COMPARISON_WIDGETS[i.kind].needsMc;
    });
  }, [layout]);

  const mcState = useSharedMcRun({
    clientId,
    plans,
    enabled: mcEnabled,
  });
  const mc = mcState.status === "ready" ? mcState.result ?? null : null;

  const isLive =
    plans.length >= 2 && plans.some((p, i) => i > 0 && p.id !== plans[0].id);

  if (!isLive && !customizing) {
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
      onExitCustomize();
    }
  };

  return (
    <>
      {customizing && (
        <CustomizeToolbar
          onAddText={api.addTextBlock}
          onReset={api.reset}
          onDone={handleDone}
          saving={api.saving}
        />
      )}
      {customizing ? (
        <div>
          {layout.items.map((item) => {
            const def = COMPARISON_WIDGETS[item.kind];
            const markdownBody =
              item.kind === "text"
                ? (item.config as { markdown?: string } | undefined)?.markdown
                : undefined;
            return (
              <WidgetChrome
                key={item.instanceId}
                instanceId={item.instanceId}
                title={def.title}
                kind={item.kind}
                hidden={item.hidden}
                collapsed={item.collapsed}
                markdownBody={markdownBody}
                onToggleHidden={api.toggleHidden}
                onToggleCollapsed={api.toggleCollapsed}
                onMarkdownChange={api.updateTextMarkdown}
              >
                {def.render({
                  clientId,
                  plans,
                  mc,
                  collapsed: item.collapsed,
                  config: item.config,
                })}
              </WidgetChrome>
            );
          })}
        </div>
      ) : (
        <WidgetRenderer layout={layout} clientId={clientId} plans={plans} mc={mc} />
      )}
    </>
  );
}
