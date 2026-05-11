"use client";

import type { ReactNode } from "react";
import type { ComparisonWidgetKind } from "@/lib/comparison/layout-schema";

interface Props {
  instanceId: string;
  title: string;
  kind: ComparisonWidgetKind;
  hidden: boolean;
  collapsed: boolean;
  /** Only meaningful when kind === "text" */
  markdownBody?: string;
  onToggleHidden: (instanceId: string) => void;
  onToggleCollapsed: (instanceId: string) => void;
  onMarkdownChange?: (instanceId: string, markdown: string) => void;
  /** Slot for the rendered widget body. Ignored when hidden or (for text) replaced. */
  children: ReactNode;
}

export function WidgetChrome({
  instanceId,
  title,
  kind,
  hidden,
  collapsed,
  markdownBody,
  onToggleHidden,
  onToggleCollapsed,
  onMarkdownChange,
  children,
}: Props) {
  if (hidden) {
    return (
      <div className="flex items-center gap-3 border-y border-slate-800 bg-slate-900/40 px-6 py-2 text-xs text-slate-500">
        <button
          type="button"
          aria-label="Drag to reorder"
          className="cursor-grab text-slate-600"
          data-drag-handle
        >
          ⋮⋮
        </button>
        <span className="flex-1">{title}{" "}<span className="italic">(hidden)</span></span>
        <button
          type="button"
          aria-label="Show widget"
          className="rounded px-2 py-0.5 text-slate-400 hover:bg-slate-800"
          onClick={() => onToggleHidden(instanceId)}
        >
          ⊕ Show
        </button>
      </div>
    );
  }

  return (
    <div className="border-y border-slate-800">
      <div className="flex items-center gap-3 bg-slate-900/40 px-6 py-2 text-xs text-slate-400">
        <button
          type="button"
          aria-label="Drag to reorder"
          className="cursor-grab text-slate-600"
          data-drag-handle
        >
          ⋮⋮
        </button>
        <span className="flex-1 font-medium text-slate-300">{title}</span>
        <button
          type="button"
          aria-label="Collapse widget"
          className="rounded px-2 py-0.5 hover:bg-slate-800"
          onClick={() => onToggleCollapsed(instanceId)}
        >
          {collapsed ? "▸ Expand" : "▾ Collapse"}
        </button>
        <button
          type="button"
          aria-label="Hide widget"
          className="rounded px-2 py-0.5 hover:bg-slate-800"
          onClick={() => onToggleHidden(instanceId)}
        >
          ⊘ Hide
        </button>
      </div>
      {!collapsed && kind === "text" ? (
        <div className="px-6 py-3">
          <textarea
            className="w-full rounded border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-200"
            rows={4}
            value={markdownBody ?? ""}
            onChange={(e) =>
              onMarkdownChange?.(instanceId, e.target.value)
            }
            placeholder="Type markdown… **bold**, *italic*, - list items"
          />
        </div>
      ) : !collapsed ? (
        children
      ) : null}
    </div>
  );
}
