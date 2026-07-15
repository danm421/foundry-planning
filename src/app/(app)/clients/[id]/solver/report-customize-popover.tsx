"use client";

import { useEffect, useRef } from "react";
import type { ComponentType, SVGProps } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  resolveReportLayout,
  type ReportKey,
  type ReportLayoutEntry,
} from "@/lib/solver/report-layout";

export interface ReportMeta {
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

interface Props {
  layout: ReportLayoutEntry[];
  meta: Record<ReportKey, ReportMeta>;
  onChange: (next: ReportLayoutEntry[]) => void;
  onClose: () => void;
}

export function ReportCustomizePopover({ layout, meta, onChange, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Close on outside click / Escape.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const visibleCount = layout.filter((e) => e.visible).length;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = layout.findIndex((e) => e.id === active.id);
    const to = layout.findIndex((e) => e.id === over.id);
    if (from < 0 || to < 0) return;
    onChange(arrayMove(layout, from, to));
  }

  function toggle(id: ReportKey) {
    const entry = layout.find((e) => e.id === id);
    if (!entry) return;
    // Never hide the last visible report.
    if (entry.visible && visibleCount <= 1) return;
    onChange(
      layout.map((e) => (e.id === id ? { ...e, visible: !e.visible } : e)),
    );
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Customize reports"
      className="absolute right-0 top-full z-20 mt-1 w-64 rounded-lg border border-hair bg-card p-2 shadow-lg"
    >
      <div className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-3">
        Customize reports
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={layout.map((e) => e.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="space-y-0.5">
            {layout.map((entry) => (
              <ReportRow
                key={entry.id}
                entry={entry}
                meta={meta[entry.id]}
                canHide={!(entry.visible && visibleCount <= 1)}
                onToggle={() => toggle(entry.id)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <div className="mt-2 flex items-center justify-between border-t border-hair-2 pt-2">
        <button
          type="button"
          onClick={() => onChange(resolveReportLayout(null))}
          className="rounded px-2 py-1 text-[11px] text-ink-3 transition-colors hover:text-ink"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded bg-accent px-3 py-1 text-[11px] font-medium text-accent-on transition-colors hover:bg-accent-ink"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function ReportRow({
  entry,
  meta,
  canHide,
  onToggle,
}: {
  entry: ReportLayoutEntry;
  meta: ReportMeta;
  canHide: boolean;
  onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: entry.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const Icon = meta.icon;
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded px-1 py-1 hover:bg-hair-2/40"
    >
      <button
        type="button"
        aria-label={`Drag ${meta.label}`}
        className="cursor-grab touch-none text-ink-3 active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="4" r="1.2" /><circle cx="11" cy="4" r="1.2" />
          <circle cx="5" cy="8" r="1.2" /><circle cx="11" cy="8" r="1.2" />
          <circle cx="5" cy="12" r="1.2" /><circle cx="11" cy="12" r="1.2" />
        </svg>
      </button>
      <Icon className="h-4 w-4 shrink-0 text-ink-3" />
      <span className="min-w-0 flex-1 truncate text-xs text-ink">{meta.label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={entry.visible}
        aria-label={meta.label}
        disabled={!canHide}
        onClick={onToggle}
        className={
          entry.visible
            ? "relative h-4 w-7 shrink-0 rounded-full bg-accent transition-colors disabled:opacity-50"
            : "relative h-4 w-7 shrink-0 rounded-full bg-hair-2 transition-colors"
        }
      >
        <span
          className={
            entry.visible
              ? "absolute top-0.5 left-3.5 h-3 w-3 rounded-full bg-white transition-all"
              : "absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white transition-all"
          }
        />
      </button>
    </li>
  );
}
