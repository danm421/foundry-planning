"use client";

import { useCallback, useMemo, useState } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import type {
  ComparisonLayout,
  ComparisonLayoutItem,
  ComparisonWidgetKind,
  YearRange,
} from "@/lib/comparison/layout-schema";
import { getDefaultLayout } from "@/lib/comparison/widgets/default-layout";

export interface UseLayoutApi {
  layout: ComparisonLayout;
  move: (fromIndex: number, toIndex: number) => void;
  add: (kind: ComparisonWidgetKind, atIndex?: number) => void;
  remove: (instanceId: string) => void;
  insertTextAt: (index: number) => void;
  addTextBlock: () => void;
  updateTextMarkdown: (instanceId: string, markdown: string) => void;
  setYearRange: (next: YearRange | null) => void;
  reset: () => void;
  save: () => Promise<void>;
  saving: boolean;
}

function makeItem(
  kind: ComparisonWidgetKind,
  extra?: Partial<ComparisonLayoutItem>,
): ComparisonLayoutItem {
  return {
    instanceId: crypto.randomUUID(),
    kind,
    ...(extra ?? {}),
  };
}

function insertAt<T>(arr: T[], index: number, item: T): T[] {
  const clamped = Math.max(0, Math.min(arr.length, index));
  const next = [...arr];
  next.splice(clamped, 0, item);
  return next;
}

export function useLayout(initial: ComparisonLayout, clientId: string): UseLayoutApi {
  const [layout, setLayout] = useState<ComparisonLayout>(initial);
  const [saving, setSaving] = useState(false);

  const move = useCallback((fromIndex: number, toIndex: number) => {
    setLayout((prev) => {
      if (fromIndex === toIndex) return prev;
      return { ...prev, items: arrayMove(prev.items, fromIndex, toIndex) };
    });
  }, []);

  const add = useCallback(
    (kind: ComparisonWidgetKind, atIndex?: number) => {
      setLayout((prev) => {
        const item = makeItem(kind);
        const idx = atIndex ?? prev.items.length;
        return { ...prev, items: insertAt(prev.items, idx, item) };
      });
    },
    [],
  );

  const remove = useCallback((instanceId: string) => {
    setLayout((prev) => ({
      ...prev,
      items: prev.items.filter((i) => i.instanceId !== instanceId),
    }));
  }, []);

  const insertTextAt = useCallback((index: number) => {
    setLayout((prev) => {
      const item = makeItem("text", { config: { markdown: "" } });
      return { ...prev, items: insertAt(prev.items, index, item) };
    });
  }, []);

  const addTextBlock = useCallback(() => {
    setLayout((prev) => {
      const item = makeItem("text", { config: { markdown: "" } });
      return { ...prev, items: insertAt(prev.items, prev.items.length, item) };
    });
  }, []);

  const updateTextMarkdown = useCallback((instanceId: string, markdown: string) => {
    setLayout((prev) => ({
      ...prev,
      items: prev.items.map((i) =>
        i.instanceId === instanceId ? { ...i, config: { markdown } } : i,
      ),
    }));
  }, []);

  const setYearRange = useCallback(
    (next: YearRange | null) =>
      setLayout((prev) => {
        // Same-reference (and same-value for null) bail-out so callers don't
        // trigger downstream re-renders when nothing changed.
        if (prev.yearRange === next) return prev;
        if (
          prev.yearRange &&
          next &&
          prev.yearRange.start === next.start &&
          prev.yearRange.end === next.end
        ) {
          return prev;
        }
        return { ...prev, yearRange: next };
      }),
    [],
  );

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

  return useMemo(
    () => ({
      layout,
      move,
      add,
      remove,
      insertTextAt,
      addTextBlock,
      updateTextMarkdown,
      setYearRange,
      reset,
      save,
      saving,
    }),
    [
      layout,
      move,
      add,
      remove,
      insertTextAt,
      addTextBlock,
      updateTextMarkdown,
      setYearRange,
      reset,
      save,
      saving,
    ],
  );
}
