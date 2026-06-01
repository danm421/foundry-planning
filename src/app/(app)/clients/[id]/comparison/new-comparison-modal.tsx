"use client";
import { useEffect, useState } from "react";

export interface PresetSummary {
  key: string;
  name: string;
  description: string;
  slotCount: number;
  slotLabels: string[];
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  visibility: "private" | "firm";
  slotCount: number;
  slotLabels: string[];
  editable: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onPickBlank: () => void;
  onPickPreset: (preset: PresetSummary) => void;
  onPickTemplate: (template: TemplateSummary) => void;
}

export function NewComparisonModal({
  open,
  onClose,
  onPickBlank,
  onPickPreset,
  onPickTemplate,
}: Props) {
  const [presets, setPresets] = useState<PresetSummary[]>([]);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch("/api/firms/comparison-templates");
        const d = await r.json();
        if (cancelled) return;
        setPresets(d.presets ?? []);
        setTemplates(d.templates ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-lg border border-hair bg-card p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">New comparison</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-ink-3 hover:bg-card-hover hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 max-h-[60vh] overflow-y-auto rounded-md border border-hair-2 bg-card-2">
          <button
            type="button"
            onClick={onPickBlank}
            className="block w-full border-b border-hair-2 px-4 py-3 text-left hover:bg-card-hover"
          >
            <div className="text-sm font-medium text-ink">Blank canvas</div>
            <div className="text-xs text-ink-3">Start with an empty grid.</div>
          </button>

          {loading && (
            <div className="px-4 py-3 text-sm text-ink-3">Loading templates…</div>
          )}

          {!loading && presets.length > 0 && (
            <div>
              <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-4">
                Built-in
              </div>
              {presets.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => onPickPreset(p)}
                  className="block w-full border-t border-hair-2 px-4 py-3 text-left hover:bg-card-hover"
                >
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-ink">{p.name}</div>
                    <span className="rounded-full bg-card-hover px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-3">
                      Built-in
                    </span>
                    <span className="text-xs text-ink-4">{p.slotCount} slots</span>
                  </div>
                  <div className="mt-0.5 text-xs text-ink-3">{p.description}</div>
                </button>
              ))}
            </div>
          )}

          {!loading && templates.length > 0 && (
            <div>
              <div className="border-t border-hair-2 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-4">
                Your firm&apos;s templates
              </div>
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onPickTemplate(t)}
                  className="block w-full border-t border-hair-2 px-4 py-3 text-left hover:bg-card-hover"
                >
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-ink">{t.name}</div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                        t.visibility === "firm"
                          ? "bg-good/10 text-good"
                          : "bg-card-hover text-ink-3"
                      }`}
                    >
                      {t.visibility}
                    </span>
                    <span className="text-xs text-ink-4">{t.slotCount} slots</span>
                  </div>
                  {t.description && (
                    <div className="mt-0.5 text-xs text-ink-3">{t.description}</div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
