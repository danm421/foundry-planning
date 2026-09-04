"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AlertCircleIcon } from "@/components/icons";
import { CrmNoteDialog } from "@/components/crm-note-dialog";
import type { NoteRow, NoteKind } from "@/lib/crm/notes";
import {
  SectionLabel,
  chipClass,
  primaryButtonClass,
} from "@/components/crm-section-primitives";

const KIND_LABELS: Record<NoteKind, string> = {
  note: "General",
  meeting: "Meeting",
  call: "Call",
  email: "Email",
};

// occurredAt is stored at noon UTC; format the UTC date so the shown date
// equals the entered date in any US timezone.
function formatNoteDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Strip common markdown tokens for a compact preview.
function markdownPreview(md: string, max = 200): string {
  const plain = md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max)}…` : plain;
}

export function CrmNotesList({ householdId }: { householdId: string }) {
  const [rows, setRows] = useState<NoteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<NoteRow | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/crm/households/${householdId}/notes`, {
        signal: ctrl.signal,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Failed to load notes (${res.status})`);
      const j = (await res.json()) as { notes: NoteRow[] };
      setRows(j.notes ?? []);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load notes");
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    reload();
    return () => abortRef.current?.abort();
  }, [reload]);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(note: NoteRow) {
    setEditing(note);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-4">
      <SectionLabel segments={["Notes", `${rows.length} records`]}>
        <button type="button" onClick={openCreate} className={primaryButtonClass}>
          New note
        </button>
      </SectionLabel>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-crit/30 bg-crit/10 px-3 py-2 text-[13px] text-crit"
        >
          <AlertCircleIcon width={16} height={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-3">
          Loading notes…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-hair-2 px-6 py-10 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">No notes yet.</p>
          <p className="mt-2 text-[13px] text-ink-3">
            Click &ldquo;New note&rdquo; to record a meeting note.
          </p>
        </div>
      ) : (
        <ul className="grid items-start gap-3 [grid-template-columns:repeat(auto-fill,minmax(340px,1fr))]">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => openEdit(row)}
                className="h-full w-full rounded-[var(--radius)] border border-hair-2 bg-card p-[18px] text-left transition-colors duration-150 hover:border-hair-3 hover:bg-card-hover"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-[15px] font-semibold text-ink">{row.title}</p>
                  <span className="tabular shrink-0 text-[11px] text-ink-3">
                    {formatNoteDate(row.occurredAt)}
                  </span>
                </div>
                {row.body && (
                  <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink-2">
                    {markdownPreview(row.body)}
                  </p>
                )}
                <div className="mt-3">
                  <span className={chipClass}>{KIND_LABELS[row.kind]}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <CrmNoteDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        householdId={householdId}
        note={editing}
        onSaved={reload}
      />
    </div>
  );
}
