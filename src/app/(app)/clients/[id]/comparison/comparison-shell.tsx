"use client";

import { useMemo } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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

function SortableRow({
  instanceId,
  children,
}: {
  instanceId: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, attributes, listeners, transform, transition } = useSortable({
    id: instanceId,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <div {...listeners}>{children}</div>
    </div>
  );
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

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

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const fromIndex = layout.items.findIndex((i) => i.instanceId === active.id);
    const toIndex = layout.items.findIndex((i) => i.instanceId === over.id);
    if (fromIndex < 0 || toIndex < 0) return;
    api.move(fromIndex, toIndex);
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
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext
            items={layout.items.map((i) => i.instanceId)}
            strategy={verticalListSortingStrategy}
          >
            <div>
              {layout.items.map((item) => {
                const def = COMPARISON_WIDGETS[item.kind];
                const markdownBody =
                  item.kind === "text"
                    ? (item.config as { markdown?: string } | undefined)?.markdown
                    : undefined;
                return (
                  <SortableRow key={item.instanceId} instanceId={item.instanceId}>
                    <WidgetChrome
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
                  </SortableRow>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <WidgetRenderer layout={layout} clientId={clientId} plans={plans} mc={mc} />
      )}
    </>
  );
}
