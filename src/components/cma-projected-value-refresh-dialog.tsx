"use client";

import { useState, useEffect, useCallback } from "react";
import DialogShell from "./dialog-shell";

interface FieldChange {
  field: string;
  current: string;
  next: string;
}
interface ClassValueDiff {
  id: string;
  name: string;
  changes: FieldChange[];
}
interface Preview {
  generatedAt: string;
  classChanges: ClassValueDiff[];
}

const FIELD_LABELS: Record<string, string> = {
  geometricReturn: "Geo return",
  arithmeticMean: "Arith mean",
  volatility: "Volatility",
};

// Decimal string → percentage display.
function fmt(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return `${parseFloat((n * 100).toFixed(4)).toString()}%`;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful refresh so the parent can re-fetch CMAs. */
  onRefreshed: () => void;
}

export default function CmaProjectedValueRefreshDialog({ open, onOpenChange, onRefreshed }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/cma/projected-value-refresh-preview");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as Preview;
      setPreview(data);
      setSelected(new Set(data.classChanges.map((c) => c.id))); // default: adopt all
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load preview");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchPreview();
  }, [open, fetchPreview]);

  const nothingStale = preview && preview.classChanges.length === 0;

  async function submit() {
    if (!preview) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/cma/refresh-projected-values", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classIds: [...selected] }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onRefreshed();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setSubmitting(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll(on: boolean) {
    setSelected(on && preview ? new Set(preview.classChanges.map((c) => c.id)) : new Set());
  }

  const canSubmit = preview && !nothingStale && selected.size > 0;

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Refresh projected assumptions"
      size="lg"
      primaryAction={
        preview && !nothingStale
          ? {
              label: submitting ? "Refreshing…" : "Apply refresh",
              onClick: submit,
              disabled: loading || submitting || !canSubmit,
              loading: submitting,
            }
          : undefined
      }
    >
      {loading && <p className="text-sm text-ink-2">Loading comparison…</p>}

      {error && (
        <p role="alert" className="mb-4 rounded bg-red-900/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {preview && (
        <p className="mb-4 text-xs text-ink-3">Projected set generated {preview.generatedAt}.</p>
      )}

      {nothingStale && (
        <p className="text-sm text-ink-2">Your projected assumptions are up to date.</p>
      )}

      {preview && !nothingStale && (
        <div className="space-y-6">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">
                {preview.classChanges.length} asset class
                {preview.classChanges.length === 1 ? "" : "es"} with updated assumptions
              </h3>
              <div className="flex gap-3 text-xs">
                <button
                  type="button"
                  className="text-ink-2 underline hover:text-ink"
                  onClick={() => selectAll(true)}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="text-ink-2 underline hover:text-ink"
                  onClick={() => selectAll(false)}
                >
                  None
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {preview.classChanges.map((c) => (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-hair p-3"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink">{c.name}</div>
                    <div className="mt-1 space-y-0.5">
                      {c.changes.map((ch) => (
                        <div key={ch.field} className="text-xs text-ink-2">
                          {FIELD_LABELS[ch.field] ?? ch.field}:{" "}
                          <span className="text-ink-3">{fmt(ch.current)}</span> →{" "}
                          <span className="text-ink">{fmt(ch.next)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </DialogShell>
  );
}
