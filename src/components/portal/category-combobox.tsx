"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { createPortal } from "react-dom";
import { CategoryPill } from "@/components/portal/category-pill";

type CategoryRow = { id: string; name: string; kind: "group" | "category"; parentId: string | null; color: string | null };

const MENU_W = 240;

// Click-to-edit category control: a compact, searchable popover (portaled to
// body so the list's overflow-hidden can't clip it). Replaces a native <select>,
// whose dropdown renders full-width and only supports first-letter type-ahead.
export function CategoryComboBox({
  categories,
  value,
  currentName,
  currentColor,
  onPick,
}: {
  categories: CategoryRow[];
  value: string | null;
  currentName: string | null;
  currentColor: string | null;
  onPick: (categoryId: string | null) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxH: number } | null>(null);

  const close = useCallback(() => { setOpen(false); setQuery(""); }, []);

  const openMenu = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - MENU_W - 8);
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    const openUp = spaceBelow < 280 && spaceAbove > spaceBelow;
    setPos(
      openUp
        ? { left, bottom: window.innerHeight - r.top + 4, maxH: Math.min(360, spaceAbove - 12) }
        : { left, top: r.bottom + 4, maxH: Math.min(360, spaceBelow - 12) },
    );
    setQuery("");
    setOpen(true);
  }, []);

  // Reposition is stale once the page scrolls/resizes — just close (native selects do too).
  useEffect(() => {
    if (!open) return;
    const onMove = () => close();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const groups = useMemo(() => categories.filter((c) => c.kind === "group"), [categories]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const leaves = categories.filter((c) => c.kind === "category");
    return groups
      .map((g) => ({
        group: g,
        leaves: leaves.filter(
          (l) => l.parentId === g.id && (!q || l.name.toLowerCase().includes(q) || g.name.toLowerCase().includes(q)),
        ),
      }))
      .filter((grp) => grp.leaves.length > 0);
  }, [categories, groups, query]);

  const firstMatch = filtered[0]?.leaves[0] ?? null;

  const pick = (id: string | null) => { onPick(id); close(); };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openMenu}
        title="Change category"
        className="flex w-full items-center rounded-md px-1.5 py-1 text-left hover:bg-card-2"
      >
        <CategoryPill name={currentName} color={currentColor} />
      </button>
      {open && pos &&
        createPortal(
          <>
            <button
              type="button"
              aria-label="Close category menu"
              onClick={close}
              className="fixed inset-0 z-50 cursor-default"
            />
            <div
              role="dialog"
              aria-label="Choose category"
              className="fixed z-50 flex flex-col overflow-hidden rounded-lg border border-hair bg-card shadow-lg"
              style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: MENU_W, maxHeight: pos.maxH }}
            >
              <div className="border-b border-hair p-2">
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && firstMatch) { e.preventDefault(); pick(firstMatch.id); } }}
                  placeholder="Search categories…"
                  aria-label="Search categories"
                  className="w-full rounded-md border border-hair bg-card-2 px-2 py-1 text-[13px] text-ink placeholder:text-ink-4"
                />
              </div>
              <ul className="min-h-0 flex-1 overflow-auto py-1">
                <li>
                  <button
                    type="button"
                    onClick={() => pick(null)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-ink-3 hover:bg-card-2"
                  >
                    <span className="flex-1">Uncategorized</span>
                    {value === null && <CheckIcon />}
                  </button>
                </li>
                {filtered.map((grp) => (
                  <li key={grp.group.id}>
                    <div className="px-3 pb-0.5 pt-2 text-[11px] font-medium uppercase tracking-wide text-ink-4">
                      {grp.group.name}
                    </div>
                    {grp.leaves.map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => pick(l.id)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-ink-2 hover:bg-card-2"
                      >
                        <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: l.color ?? "var(--data-grey)" }} />
                        <span className="flex-1 truncate">{l.name}</span>
                        {value === l.id && <CheckIcon />}
                      </button>
                    ))}
                  </li>
                ))}
                {filtered.length === 0 && (
                  <li className="px-3 py-2 text-[12px] text-ink-4">No categories match.</li>
                )}
              </ul>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

function CheckIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5 shrink-0 text-accent"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
