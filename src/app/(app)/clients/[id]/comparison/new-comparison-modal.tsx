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
    setLoading(true);
    fetch("/api/firms/comparison-templates")
      .then((r) => r.json())
      .then((d) => {
        setPresets(d.presets ?? []);
        setTemplates(d.templates ?? []);
      })
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-100">New comparison</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 max-h-[60vh] overflow-y-auto rounded-md border border-slate-800 bg-slate-950">
          <button
            type="button"
            onClick={onPickBlank}
            className="block w-full border-b border-slate-800 px-4 py-3 text-left hover:bg-slate-800"
          >
            <div className="text-sm font-medium text-slate-100">Blank canvas</div>
            <div className="text-xs text-slate-400">Start with an empty grid.</div>
          </button>

          {loading && (
            <div className="px-4 py-3 text-sm text-slate-400">Loading templates…</div>
          )}

          {!loading && presets.length > 0 && (
            <div>
              <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Built-in
              </div>
              {presets.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => onPickPreset(p)}
                  className="block w-full border-t border-slate-800 px-4 py-3 text-left hover:bg-slate-800"
                >
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-slate-100">{p.name}</div>
                    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                      Built-in
                    </span>
                    <span className="text-xs text-slate-500">{p.slotCount} slots</span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">{p.description}</div>
                </button>
              ))}
            </div>
          )}

          {!loading && templates.length > 0 && (
            <div>
              <div className="border-t border-slate-800 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Your firm&apos;s templates
              </div>
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onPickTemplate(t)}
                  className="block w-full border-t border-slate-800 px-4 py-3 text-left hover:bg-slate-800"
                >
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-slate-100">{t.name}</div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                        t.visibility === "firm"
                          ? "bg-emerald-900/60 text-emerald-300"
                          : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {t.visibility}
                    </span>
                    <span className="text-xs text-slate-500">{t.slotCount} slots</span>
                  </div>
                  {t.description && (
                    <div className="mt-0.5 text-xs text-slate-400">{t.description}</div>
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
