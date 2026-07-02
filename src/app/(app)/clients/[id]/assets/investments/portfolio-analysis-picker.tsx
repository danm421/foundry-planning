"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisRow } from "@/lib/investments/portfolio-analysis";
import { SERIES, colorForRow } from "./portfolio-analysis-series";

interface PaletteProps {
  open: boolean;
  rows: AnalysisRow[];
  selectedKeys: Set<string>;
  /** Add one row by key. Palette stays open. */
  onAdd: (key: string) => void;
  /** Add every (filtered) row of one type. */
  onAddMany: (keys: string[]) => void;
  onClose: () => void;
}

function EntityPalette({ open, rows, selectedKeys, onAdd, onAddMany, onClose }: PaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Group filtered rows by series type, preserving SERIES order; drop empty groups.
  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SERIES.map((s) => {
      const matched = rows
        .filter((r) => r.type === s.type && (q === "" || r.name.toLowerCase().includes(q)))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { series: s, rows: matched };
    }).filter((sec) => sec.rows.length > 0);
  }, [rows, query]);

  // Flat order for keyboard navigation.
  const order = useMemo(() => sections.flatMap((sec) => sec.rows.map((r) => r.key)), [sections]);
  const clampedIndex = Math.min(activeIndex, Math.max(0, order.length - 1));
  const activeKey = order[clampedIndex];

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (activeKey) {
      document.getElementById(`entity-row-${activeKey}`)?.scrollIntoView?.({ block: "nearest" });
    }
  }, [activeKey]);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(order.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeKey && !selectedKeys.has(activeKey)) onAdd(activeKey);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add to chart"
        className="w-full max-w-xl overflow-hidden rounded-lg border border-hair bg-card-2 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={true}
          aria-controls="entity-palette-list"
          aria-activedescendant={activeKey ? `entity-row-${activeKey}` : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search accounts, groups, models…"
          className="w-full border-b border-hair bg-transparent px-4 py-3 text-sm text-ink outline-none placeholder:text-ink-4"
        />

        <div id="entity-palette-list" role="listbox" className="max-h-[50vh] overflow-y-auto py-1 text-sm">
          {sections.length === 0 && (
            <div className="px-4 py-6 text-center text-xs italic text-ink-4">
              Nothing matches &ldquo;{query}&rdquo;
            </div>
          )}
          {sections.map((sec) => {
            const addableKeys = sec.rows.map((r) => r.key).filter((k) => !selectedKeys.has(k));
            return (
              <div key={sec.series.type} role="group" aria-label={sec.series.label}>
                <div className="flex items-center justify-between px-4 pb-1 pt-2">
                  <span
                    aria-hidden="true"
                    className="text-[10px] font-semibold uppercase tracking-wide text-ink-4"
                  >
                    {sec.series.label}
                  </span>
                  {addableKeys.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onAddMany(addableKeys)}
                      className="text-[10px] font-medium text-accent hover:underline"
                    >
                      Add all ({addableKeys.length})
                    </button>
                  )}
                </div>
                {sec.rows.map((r) => {
                  const isActive = r.key === activeKey;
                  const isAdded = selectedKeys.has(r.key);
                  return (
                    <div
                      key={r.key}
                      id={`entity-row-${r.key}`}
                      role="option"
                      aria-selected={isActive}
                      onMouseEnter={() => setActiveIndex(order.indexOf(r.key))}
                      onClick={() => {
                        if (!isAdded) onAdd(r.key);
                      }}
                      className={`flex items-center justify-between gap-3 px-4 py-1.5 ${
                        isAdded ? "cursor-default opacity-50" : "cursor-pointer"
                      } ${isActive && !isAdded ? "bg-card-hover" : ""}`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: colorForRow(r) }}
                        />
                        <span className="truncate text-ink">{r.name}</span>
                      </span>
                      {isAdded && <span className="shrink-0 text-[10px] text-ink-3">Added ✓</span>}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="flex gap-4 border-t border-hair px-4 py-2 text-[10px] text-ink-4">
          <span>↑↓ navigate</span>
          <span>↵ add</span>
          <span>esc done</span>
        </div>
      </div>
    </div>
  );
}

interface AddToChartButtonProps {
  rows: AnalysisRow[];
  selectedKeys: Set<string>;
  onAdd: (key: string) => void;
  onAddMany: (keys: string[]) => void;
}

export function AddToChartButton({ rows, selectedKeys, onAdd, onAddMany }: AddToChartButtonProps) {
  const [open, setOpen] = useState(false);

  // ⌘K / Ctrl-K opens the palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-dashed border-hair-2 px-3 py-2 text-sm text-ink-2 transition-colors hover:border-accent hover:text-accent"
      >
        ⊕ Add to chart
      </button>
      {open && (
        <EntityPalette
          open={open}
          rows={rows}
          selectedKeys={selectedKeys}
          onAdd={onAdd}
          onAddMany={onAddMany}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
