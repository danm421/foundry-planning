"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { inputBaseClassName } from "@/components/forms/input-styles";

export type CrmTagOption = {
  id: string;
  label: string;
  color: string;
};

interface CrmTaskTagPickerProps {
  /** Currently attached tag ids on the task. */
  value: string[];
  firmTags: CrmTagOption[];
  /** Called when the user picks an existing or just-created tag. */
  onAttach: (tagId: string) => void;
  onDetach: (tagId: string) => void;
  /** Called when a new tag was created on the server — caller pushes it
   *  into its firmTags cache. */
  onTagCreated?: (tag: CrmTagOption) => void;
  disabled?: boolean;
  id?: string;
}

const COLOR_CLASS: Record<string, string> = {
  gold: "bg-amber-100 text-amber-900 border-amber-300",
  green: "bg-emerald-100 text-emerald-900 border-emerald-300",
  blue: "bg-sky-100 text-sky-900 border-sky-300",
  red: "bg-rose-100 text-rose-900 border-rose-300",
  purple: "bg-violet-100 text-violet-900 border-violet-300",
  orange: "bg-orange-100 text-orange-900 border-orange-300",
  teal: "bg-teal-100 text-teal-900 border-teal-300",
  gray: "bg-card-2 text-ink-2 border-hair",
};

function colorClass(color: string): string {
  return COLOR_CLASS[color] ?? COLOR_CLASS.gray;
}

/**
 * Multi-select tag chips + click-to-open dropdown with inline "+ Create
 * '<query>'" affordance. Creating posts to `/api/crm/tags` and then
 * calls `onAttach` with the new tag id; the parent owns the actual
 * attach/detach API calls so the picker stays scope-agnostic.
 */
export function CrmTaskTagPicker({
  value,
  firmTags,
  onAttach,
  onDetach,
  onTagCreated,
  disabled,
  id,
}: CrmTaskTagPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
        setError(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
        setError(null);
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = useMemo(
    () => value.map((id) => firmTags.find((t) => t.id === id)).filter(Boolean) as CrmTagOption[],
    [value, firmTags],
  );

  const q = query.trim();
  const qLower = q.toLowerCase();
  const filtered = qLower
    ? firmTags.filter((t) => t.label.toLowerCase().includes(qLower))
    : firmTags;

  const exactExists = firmTags.some((t) => t.label.toLowerCase() === qLower);
  const canCreate = q.length > 0 && !exactExists;

  async function createNew() {
    if (!canCreate || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/crm/tags", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: q, color: "gray" }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          typeof j.error === "string" ? j.error : `Create failed (${res.status})`,
        );
      }
      const { tag } = (await res.json()) as { tag: CrmTagOption };
      onTagCreated?.(tag);
      onAttach(tag.id);
      setQuery("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <div
        id={id}
        className={`${inputBaseClassName} flex min-h-9 w-full flex-wrap items-center gap-1.5 py-1 ` +
          (disabled ? "opacity-50" : "")}
      >
        {selected.map((tag) => (
          <span
            key={tag.id}
            className={
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium " +
              colorClass(tag.color)
            }
          >
            {tag.label}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onDetach(tag.id)}
              aria-label={`Remove ${tag.label}`}
              className="text-[10px] leading-none opacity-60 hover:opacity-100"
            >
              ×
            </button>
          </span>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          className="text-[12px] text-ink-3 hover:text-ink"
        >
          + Add tag
        </button>
      </div>
      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-hidden rounded-[var(--radius-sm)] border border-hair bg-card shadow-lg">
          <div className="border-b border-hair p-2">
            <input
              autoFocus
              type="text"
              placeholder="Find or create a tag…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canCreate) {
                  e.preventDefault();
                  void createNew();
                }
              }}
              className={`${inputBaseClassName} h-8 w-full text-[13px]`}
            />
            {error && (
              <p role="alert" className="mt-1 text-[11px] text-crit">
                {error}
              </p>
            )}
          </div>
          <ul className="max-h-48 overflow-y-auto py-1">
            {filtered.map((tag) => {
              const attached = value.includes(tag.id);
              return (
                <li key={tag.id}>
                  <button
                    type="button"
                    onClick={() => (attached ? onDetach(tag.id) : onAttach(tag.id))}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px] hover:bg-card-2"
                  >
                    <span
                      className={
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium " +
                        colorClass(tag.color)
                      }
                    >
                      {tag.label}
                    </span>
                    <span className="text-[11px] text-ink-3">
                      {attached ? "Attached" : ""}
                    </span>
                  </button>
                </li>
              );
            })}
            {canCreate && (
              <li>
                <button
                  type="button"
                  disabled={creating}
                  onClick={createNew}
                  className="block w-full px-3 py-1.5 text-left text-[13px] text-accent hover:bg-card-2 disabled:opacity-50"
                >
                  {creating ? `Creating “${q}”…` : `+ Create “${q}”`}
                </button>
              </li>
            )}
            {filtered.length === 0 && !canCreate && (
              <li className="px-3 py-2 text-[12px] text-ink-3">No tags yet — type to create one</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
