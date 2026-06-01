"use client";
import { useEffect, useState } from "react";
import { TemplateRow, type PresetSummary, type TemplateSummary } from "./template-row";
import ComparisonTemplatesSkeleton from "./loading-skeleton";

export default function ComparisonTemplatesPage() {
  const [presets, setPresets] = useState<PresetSummary[]>([]);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/firms/comparison-templates")
      .then((r) => r.json())
      .then((d) => {
        setPresets(d.presets ?? []);
        setTemplates(d.templates ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="mx-auto max-w-4xl px-8 py-10">
        <h1 className="text-2xl font-semibold text-ink">Comparison templates</h1>
        <p className="mt-1 text-sm text-ink-3">
          Reusable starting points for client comparisons.
        </p>

        {loading && <ComparisonTemplatesSkeleton />}

        {!loading && (
          <>
            <h2 className="mt-10 text-[11px] font-semibold uppercase tracking-wider text-ink-4">
              Built-in
            </h2>
            <div className="mt-2 divide-y divide-hair overflow-hidden rounded-lg border border-hair bg-card/40">
              {presets.map((p) => (
                <TemplateRow key={p.key} kind="preset" preset={p} />
              ))}
            </div>

            <h2 className="mt-10 text-[11px] font-semibold uppercase tracking-wider text-ink-4">
              Your firm&apos;s templates
            </h2>
            <div className="mt-2 divide-y divide-hair overflow-hidden rounded-lg border border-hair bg-card/40">
              {templates.length === 0 ? (
                <div className="px-4 py-6 text-sm text-ink-3">
                  No templates yet. Build one by saving a client comparison as a template.
                </div>
              ) : (
                templates.map((t) => (
                  <TemplateRow
                    key={t.id}
                    kind="template"
                    template={t}
                    onChange={(next) => setTemplates(next)}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
