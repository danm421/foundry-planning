// src/components/reports/block-library.tsx
//
// Left pane of the builder. Renders the registered widgets as draggable
// cards (via @dnd-kit) grouped by category, with a search box + category
// filter. Drop targets live in the canvas (Task 12).

"use client";
import { useDraggable } from "@dnd-kit/core";
import { listWidgets, type WidgetRegistryEntry } from "@/lib/reports/widget-registry";
import { useState, useMemo } from "react";

const CATEGORIES = ["Cover", "Structure", "KPI", "Chart", "Data Table", "AI"] as const;

function LibraryCard({ entry }: { entry: WidgetRegistryEntry }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `lib-${entry.kind}`,
    data: { source: "library", kind: entry.kind },
  });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined;
  return (
    <div
      ref={setNodeRef} style={style} {...listeners} {...attributes}
      className="rounded-md border border-hair bg-card-2 p-3 cursor-grab active:cursor-grabbing hover:border-ink-3"
    >
      <div className="text-[12px] font-mono uppercase tracking-wider text-ink-3 mb-1">{entry.category}</div>
      <div className="text-[14px] font-medium text-ink">{entry.label}</div>
      <div className="text-[12px] text-ink-3 mt-1">{entry.description}</div>
      <div className="text-[10px] font-mono text-ink-3 mt-2">{entry.allowedRowSizes.join(" · ")}</div>
    </div>
  );
}

export function BlockLibrary() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<typeof CATEGORIES[number] | "all">("all");
  const all = listWidgets();
  const filtered = useMemo(() => all.filter((e) =>
    (active === "all" || e.category === active) &&
    (!query || e.label.toLowerCase().includes(query.toLowerCase()))
  ), [all, query, active]);
  return (
    <aside className="w-[300px] border-r border-hair bg-card overflow-y-auto">
      <div className="p-3 border-b border-hair">
        <input
          value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search blocks…"
          className="w-full h-8 rounded-md bg-card-2 border border-hair px-2 text-[13px]"
        />
        <div className="flex flex-wrap gap-1 mt-2">
          {(["all", ...CATEGORIES] as const).map((c) => (
            <button key={c} onClick={() => setActive(c)}
              className={`h-6 px-2 rounded-full text-[11px] font-mono uppercase tracking-wider ${
                active === c ? "bg-accent text-paper" : "bg-card-2 text-ink-3 hover:text-ink"
              }`}>{c}</button>
          ))}
        </div>
      </div>
      <div className="p-3 space-y-2">
        {filtered.map((e) => <LibraryCard key={e.kind} entry={e} />)}
      </div>
    </aside>
  );
}
