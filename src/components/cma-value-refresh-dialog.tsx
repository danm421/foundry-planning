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
  missingStandardClasses: string[];
  correlationPairsToRefresh: number;
}

const FIELD_LABELS: Record<string, string> = {
  geometricReturn: "Geo return",
  arithmeticMean: "Arith mean",
  volatility: "Volatility",
  pctOrdinaryIncome: "Ordinary income",
  pctLtCapitalGains: "LT cap gains",
  pctQualifiedDividends: "Qual dividends",
  pctTaxExempt: "Tax-exempt",
  assetType: "Asset type",
};

// Decimal string → display. Numeric fields show as a percentage; assetType is raw.
function fmt(field: string, value: string): string {
  if (field === "assetType") return value;
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

export default function CmaValueRefreshDialog({ open, onOpenChange, onRefreshed }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [refreshCorr, setRefreshCorr] = useState(true);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/cma/value-refresh-preview");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as Preview;
      setPreview(data);
      setSelected(new Set(data.classChanges.map((c) => c.id))); // default: adopt all
      setRefreshCorr(data.correlationPairsToRefresh > 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load preview");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchPreview();
  }, [open, fetchPreview]);

  const nothingStale =
    preview && preview.classChanges.length === 0 && preview.correlationPairsToRefresh === 0;

  async function submit() {
    if (!preview) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/cma/refresh-standard-values", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classIds: [...selected], refreshCorrelations: refreshCorr }),
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

  const canSubmit = preview && !nothingStale && (selected.size > 0 || refreshCorr);

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Refresh standard assumptions"
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
        <p className="mb-4 text-xs text-ink-3">Standard set generated {preview.generatedAt}.</p>
      )}

      {nothingStale && (
        <p className="text-sm text-ink-2">Your standard assumptions are up to date.</p>
      )}

      {preview && !nothingStale && (
        <div className="space-y-6">
          {preview.classChanges.length > 0 && (
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
                            <span className="text-ink-3">{fmt(ch.field, ch.current)}</span> →{" "}
                            <span className="text-ink">{fmt(ch.field, ch.next)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {preview.correlationPairsToRefresh > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink">Correlations</h3>
              <label className="flex cursor-pointer items-start gap-3 rounded-md border border-hair p-3">
                <input
                  type="checkbox"
                  checked={refreshCorr}
                  onChange={(e) => setRefreshCorr(e.target.checked)}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-sm text-ink">
                    Adopt updated correlation matrix ({preview.correlationPairsToRefresh} pair
                    {preview.correlationPairsToRefresh === 1 ? "" : "s"} change)
                  </div>
                  <p className="mt-1 text-xs text-ink-3">
                    Custom correlations are replaced. Partial adoption is disabled to keep the
                    matrix valid for simulations.
                  </p>
                </div>
              </label>
            </div>
          )}

          {preview.missingStandardClasses.length > 0 && (
            <p className="text-xs text-ink-3">
              {preview.missingStandardClasses.length} standard class
              {preview.missingStandardClasses.length === 1 ? " isn't" : "es aren't"} present. Use
              “Update to standard CMAs” to add{" "}
              {preview.missingStandardClasses.length === 1 ? "it" : "them"}.
            </p>
          )}
        </div>
      )}
    </DialogShell>
  );
}
