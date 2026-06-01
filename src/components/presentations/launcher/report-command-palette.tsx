"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  PRESENTATION_PAGES,
  CATEGORY_ORDER,
  type PresentationPageId,
  type PresentationCategory,
} from "@/components/presentations/registry";
import { searchReports } from "./report-search";
import { useRecentReports } from "./use-recent-reports";

/** Filter chips: "All" clears the filter, then one chip per category. */
const CATEGORY_FILTERS: { label: string; value: PresentationCategory | null }[] = [
  { label: "All", value: null },
  ...CATEGORY_ORDER.map((c) => ({ label: c, value: c })),
];

interface PaletteProps {
  open: boolean;
  counts: Record<string, number>;
  recents: PresentationPageId[];
  /** Add a report. Palette stays open; parent decides what to do. */
  onAdd: (id: PresentationPageId) => void;
  onClose: () => void;
}

export function ReportCommandPalette({
  open,
  counts,
  recents,
  onAdd,
  onClose,
}: PaletteProps) {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<PresentationCategory | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [announce, setAnnounce] = useState("");

  const result = useMemo(
    () => searchReports(query, counts, recents, activeCategory),
    [query, counts, recents, activeCategory],
  );

  // Focus the input when the palette opens (side-effect only — no setState).
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  // Clamp activeIndex to valid range inline — avoids a setState-in-effect.
  const clampedIndex = Math.min(activeIndex, Math.max(0, result.order.length - 1));

  const activeId = result.order[clampedIndex];

  // Scroll the active row into view on keyboard navigation.
  useEffect(() => {
    if (activeId) {
      document
        .getElementById(`report-row-${activeId}`)
        ?.scrollIntoView?.({ block: "nearest" });
    }
  }, [activeId]);

  if (!open) return null;

  const add = (id: PresentationPageId, close: boolean) => {
    onAdd(id);
    setAnnounce(`Added ${PRESENTATION_PAGES[id].title}`);
    if (close) onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(result.order.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const id = result.order[clampedIndex];
      if (id) add(id, e.metaKey || e.ctrlKey);
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
        aria-label="Add a report"
        className="w-full max-w-xl overflow-hidden rounded-lg border border-hair bg-card-2 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          role="group"
          aria-label="Filter by category"
          className="flex flex-wrap gap-1.5 border-b border-hair px-3 py-2.5"
        >
          {CATEGORY_FILTERS.map((chip) => {
            const isActive = activeCategory === chip.value;
            return (
              <button
                key={chip.label}
                type="button"
                aria-pressed={isActive}
                onClick={() => {
                  setActiveCategory(chip.value);
                  setActiveIndex(0);
                }}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide transition-colors ${
                  isActive
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-hair text-ink-3 hover:border-hair-2 hover:text-ink"
                }`}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={true}
          aria-controls="report-palette-list"
          aria-activedescendant={activeId ? `report-row-${activeId}` : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search reports…"
          className="w-full border-b border-hair bg-transparent px-4 py-3 text-sm text-ink outline-none placeholder:text-ink-4"
        />

        <ul
          id="report-palette-list"
          role="listbox"
          className="max-h-[50vh] overflow-y-auto py-1 text-sm"
        >
          {result.sections.length === 0 && (
            <li className="px-4 py-6 text-center text-xs italic text-ink-4">
              {query.trim()
                ? `No reports match “${query}”${activeCategory ? ` in ${activeCategory}` : ""}`
                : `No ${activeCategory} reports yet.`}
            </li>
          )}
          {result.sections.map((section) => (
            <li key={section.heading} role="group" aria-label={section.heading}>
              <div
                aria-hidden="true"
                className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-ink-4"
              >
                {section.heading}
              </div>
              {section.rows.map((row) => {
                const isActive = row.id === activeId;
                return (
                  <li
                    key={`${section.heading}-${row.id}`}
                    id={`report-row-${row.id}`}
                    role="option"
                    aria-selected={isActive}
                    onMouseEnter={() =>
                      setActiveIndex(result.order.indexOf(row.id))
                    }
                    onClick={(e) => {
                      e.preventDefault();
                      add(row.id, e.metaKey || e.ctrlKey);
                    }}
                    className={`flex cursor-pointer items-start justify-between gap-3 px-4 py-1.5 ${
                      isActive ? "bg-card-hover" : ""
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block text-ink">{row.title}</span>
                      <span className="block truncate text-xs text-ink-4">
                        {row.description}
                      </span>
                    </span>
                    {row.count > 0 && (
                      <span className="mt-0.5 shrink-0 rounded bg-card-hover px-1.5 py-0.5 text-[10px] text-ink-3">
                        Added &times;{row.count}
                      </span>
                    )}
                  </li>
                );
              })}
            </li>
          ))}
        </ul>

        <div className="flex gap-4 border-t border-hair px-4 py-2 text-[10px] text-ink-4">
          <span>↑↓ navigate</span>
          <span>↵ add</span>
          <span>⌘↵ add &amp; close</span>
          <span>esc done</span>
        </div>

        <div aria-live="polite" className="sr-only">
          {announce}
        </div>
      </div>
    </div>
  );
}

interface AddPageButtonProps {
  counts: Record<string, number>;
  onAdd: (id: PresentationPageId) => void;
}

export function AddPageButton({ counts, onAdd }: AddPageButtonProps) {
  const [open, setOpen] = useState(false);
  const { recents, push } = useRecentReports();

  // ⌘K / Ctrl-K opens the palette — scoped to this component's lifetime.
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
        ⊕ Add page
      </button>
      {open && (
        <ReportCommandPalette
          open={open}
          counts={counts}
          recents={recents}
          onAdd={(id) => {
            onAdd(id);
            push(id);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
