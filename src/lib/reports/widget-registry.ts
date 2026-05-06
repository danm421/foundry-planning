import type { ComponentType } from "react";
import type { RowSize, Widget, WidgetKind, WidgetPropsByKind } from "./types";
import type { ScopeKey } from "./scope-registry";

export type WidgetCategory = "Cover" | "Structure" | "KPI" | "Chart" | "Data Table" | "AI";

export type WidgetData = unknown;     // narrowed per-widget via fetchData return

export type WidgetDataCtx = {
  clientId: string;
  firmId: string;
  asOfYear: number;
  retirementAge: number;
};

export type WidgetRenderProps<K extends WidgetKind> = {
  props: WidgetPropsByKind[K];
  data: WidgetData;
  mode: "screen" | "pdf";
  widgetId: string;
};

export type WidgetInspectorProps<K extends WidgetKind> = {
  props: WidgetPropsByKind[K];
  onChange: (next: WidgetPropsByKind[K]) => void;
};

export type WidgetRegistryEntry<K extends WidgetKind = WidgetKind> = {
  kind: K;
  category: WidgetCategory;
  label: string;
  description: string;
  allowedRowSizes: RowSize[];
  ownsPage?: boolean;                              // true for `cover`
  defaultProps: WidgetPropsByKind[K];
  scopes?: ScopeKey[];                             // engine scopes this widget reads
  Render: ComponentType<WidgetRenderProps<K>>;
  RenderPdf?: ComponentType<WidgetRenderProps<K>>;   // optional — PDF-only renderer
  Inspector: ComponentType<WidgetInspectorProps<K>>;
};

const REGISTRY = new Map<WidgetKind, WidgetRegistryEntry>();

export function registerWidget<K extends WidgetKind>(entry: WidgetRegistryEntry<K>): void {
  REGISTRY.set(entry.kind, entry as unknown as WidgetRegistryEntry);
}

export function registerWidgetPdf<K extends WidgetKind>(
  kind: K,
  render: ComponentType<WidgetRenderProps<K>>,
): void {
  const entry = REGISTRY.get(kind);
  if (!entry) throw new Error(`registerWidgetPdf: kind not registered yet: ${kind}`);
  (entry as unknown as WidgetRegistryEntry<K>).RenderPdf = render;
}

export function getWidget(kind: WidgetKind): WidgetRegistryEntry {
  const e = REGISTRY.get(kind);
  if (!e) throw new Error(`Unknown widget kind: ${kind}`);
  return e;
}

export function listWidgets(): WidgetRegistryEntry[] {
  return [...REGISTRY.values()];
}

export function makeWidget<K extends WidgetKind>(kind: K, id: string): Widget {
  const entry = getWidget(kind) as unknown as WidgetRegistryEntry<K>;
  return { id, kind, props: structuredClone(entry.defaultProps) } as Widget;
}
