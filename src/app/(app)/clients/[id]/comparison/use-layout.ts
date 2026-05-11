"use client";

import { useCallback, useState } from "react";
import type {
  ComparisonLayout,
  ComparisonLayoutItem,
} from "@/lib/comparison/layout-schema";
import { getDefaultLayout } from "@/lib/comparison/widgets/default-layout";

export interface UseLayoutApi {
  layout: ComparisonLayout;
  move: (fromIndex: number, toIndex: number) => void;
  toggleHidden: (instanceId: string) => void;
  toggleCollapsed: (instanceId: string) => void;
  addTextBlock: () => void;
  updateTextMarkdown: (instanceId: string, markdown: string) => void;
  reset: () => void;
  save: () => Promise<void>;
  saving: boolean;
}

export function useLayout(initial: ComparisonLayout, clientId: string): UseLayoutApi {
  const [layout, setLayout] = useState<ComparisonLayout>(initial);
  const [saving, setSaving] = useState(false);

  const move = useCallback((fromIndex: number, toIndex: number) => {
    setLayout((prev) => {
      if (fromIndex === toIndex) return prev;
      const items = [...prev.items];
      const [moved] = items.splice(fromIndex, 1);
      items.splice(toIndex, 0, moved);
      return { ...prev, items };
    });
  }, []);

  const updateItem = useCallback(
    (instanceId: string, patch: Partial<ComparisonLayoutItem>) => {
      setLayout((prev) => ({
        ...prev,
        items: prev.items.map((i) =>
          i.instanceId === instanceId ? { ...i, ...patch } : i,
        ),
      }));
    },
    [],
  );

  const toggleHidden = useCallback(
    (instanceId: string) =>
      setLayout((prev) => ({
        ...prev,
        items: prev.items.map((i) =>
          i.instanceId === instanceId ? { ...i, hidden: !i.hidden } : i,
        ),
      })),
    [],
  );

  const toggleCollapsed = useCallback(
    (instanceId: string) =>
      setLayout((prev) => ({
        ...prev,
        items: prev.items.map((i) =>
          i.instanceId === instanceId ? { ...i, collapsed: !i.collapsed } : i,
        ),
      })),
    [],
  );

  const addTextBlock = useCallback(() => {
    setLayout((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          instanceId: crypto.randomUUID(),
          kind: "text",
          hidden: false,
          collapsed: false,
          config: { markdown: "" },
        },
      ],
    }));
  }, []);

  const updateTextMarkdown = useCallback((instanceId: string, markdown: string) => {
    updateItem(instanceId, { config: { markdown } });
  }, [updateItem]);

  const reset = useCallback(() => {
    setLayout(getDefaultLayout());
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const trimmed: ComparisonLayout = {
        ...layout,
        items: layout.items.filter((i) => {
          if (i.kind !== "text") return true;
          const md = (i.config as { markdown?: string } | undefined)?.markdown ?? "";
          return md.trim() !== "";
        }),
      };
      const res = await fetch(`/api/clients/${clientId}/comparison-layout`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trimmed),
      });
      if (!res.ok) {
        throw new Error(`Layout save failed: ${res.status}`);
      }
    } finally {
      setSaving(false);
    }
  }, [clientId, layout]);

  return {
    layout,
    move,
    toggleHidden,
    toggleCollapsed,
    addTextBlock,
    updateTextMarkdown,
    reset,
    save,
    saving,
  };
}
