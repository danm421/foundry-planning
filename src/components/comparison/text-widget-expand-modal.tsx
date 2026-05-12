"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  ComparisonLayoutV5,
  TextWidgetAiConfig,
  AiTone,
  AiLength,
} from "@/lib/comparison/layout-schema";
import { resolveAiSources } from "@/lib/comparison/ai-source-resolve";
import { estimateAiTokens, formatTokenEstimate } from "@/lib/comparison/ai-tokens";
import { RichTextEditor } from "./rich-text-editor";
import { AiSourcePicker } from "./ai-source-picker";

interface Props {
  open: boolean;
  mode: "edit" | "view";
  clientId: string;
  layout: ComparisonLayoutV5;
  cellId: string;
  initialMarkdown: string;
  initialAi: TextWidgetAiConfig | undefined;
  /** Used by the live token estimate when a source widget has no
   *  explicit yearRange. Falls back to 45 (typical plan span). */
  availableYearSpan?: number;
  onClose: () => void;
  onSave: (next: { markdown: string; ai: TextWidgetAiConfig | undefined }) => void;
}

const DEFAULT_AI: TextWidgetAiConfig = {
  sources: { groupIds: [], cellIds: [] },
  tone: "concise",
  length: "medium",
  customInstructions: "",
};

export function TextWidgetExpandModal(props: Props) {
  const { open, mode, clientId, layout, cellId, initialMarkdown, initialAi, availableYearSpan, onClose, onSave } = props;
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [ai, setAi] = useState<TextWidgetAiConfig>(initialAi ?? DEFAULT_AI);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const aiRef = useRef(ai);
  aiRef.current = ai;

  useEffect(() => {
    if (!open) return;
    setMarkdown(initialMarkdown);
    setAi(initialAi ?? DEFAULT_AI);
    setGenerateError(null);
  }, [open, initialMarkdown, initialAi]);

  const estimate = useMemo(
    () =>
      estimateAiTokens({
        layout,
        selection: ai.sources,
        selfCellId: cellId,
        customInstructions: ai.customInstructions,
        length: ai.length,
        defaultPlanYearSpan: availableYearSpan ?? 45,
      }),
    [layout, ai.sources, cellId, ai.customInstructions, ai.length, availableYearSpan],
  );

  const generate = useCallback(async (force: boolean) => {
    setGenerating(true);
    setGenerateError(null);
    try {
      const resolved = resolveAiSources(layout, aiRef.current.sources, cellId);
      if (resolved.length === 0) {
        setGenerateError("Pick at least one group or widget as a source.");
        return;
      }
      const res = await fetch(`/api/clients/${clientId}/comparison/ai-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resolvedSources: resolved,
          tone: aiRef.current.tone,
          length: aiRef.current.length,
          customInstructions: aiRef.current.customInstructions,
          force,
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Generate failed (${res.status}): ${detail.slice(0, 200)}`);
      }
      const json = (await res.json()) as {
        markdown: string;
        generatedAt: string;
        cached: boolean;
        hash: string;
      };
      setMarkdown(json.markdown);
      setAi((cur) => ({
        ...cur,
        lastGenerated: { hash: json.hash, at: json.generatedAt, cached: json.cached },
      }));
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "Generate failed");
    } finally {
      setGenerating(false);
    }
  }, [cellId, clientId, layout]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Text block"
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 p-6"
    >
      <div className="flex w-full max-w-6xl flex-col rounded-lg border border-slate-800 bg-slate-950 shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-100">{mode === "edit" ? "Edit text block" : "Text block"}</h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:border-slate-500"
            >
              {mode === "edit" ? "Cancel" : "Close"}
            </button>
            {mode === "edit" && (
              <button
                type="button"
                onClick={() => onSave({ markdown, ai: ai === DEFAULT_AI ? undefined : ai })}
                className="rounded border border-amber-400 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-200 hover:bg-amber-400/20"
              >
                Save
              </button>
            )}
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <main className={mode === "edit" ? "flex flex-1 flex-col border-r border-slate-800" : "flex flex-1 flex-col"}>
            {mode === "edit" ? (
              <RichTextEditor value={markdown} onChange={setMarkdown} editable={true} placeholder="Start typing or click Generate…" />
            ) : (
              <div className="prose prose-invert prose-sm max-w-none overflow-auto p-6">
                {markdown.trim() === "" ? (
                  <p className="italic text-slate-400">Empty text block.</p>
                ) : (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
                )}
              </div>
            )}
          </main>

          {mode === "edit" && (
            <aside className="flex w-[360px] flex-col gap-4 overflow-auto bg-slate-900 p-4">
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Sources</h3>
                <AiSourcePicker
                  layout={layout}
                  selfCellId={cellId}
                  value={ai.sources}
                  onChange={(sources) => setAi((cur) => ({ ...cur, sources }))}
                />
              </section>

              <section className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs text-slate-300">
                  Tone
                  <select
                    value={ai.tone}
                    onChange={(e) => setAi((cur) => ({ ...cur, tone: e.target.value as AiTone }))}
                    className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                  >
                    <option value="concise">Concise</option>
                    <option value="detailed">Detailed</option>
                    <option value="plain">Plain</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-slate-300">
                  Length
                  <select
                    value={ai.length}
                    onChange={(e) => setAi((cur) => ({ ...cur, length: e.target.value as AiLength }))}
                    className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                  >
                    <option value="short">Short</option>
                    <option value="medium">Medium</option>
                    <option value="long">Long</option>
                  </select>
                </label>
              </section>

              <label className="flex flex-col gap-1 text-xs text-slate-300">
                Custom instructions
                <textarea
                  rows={4}
                  value={ai.customInstructions}
                  onChange={(e) => setAi((cur) => ({ ...cur, customInstructions: e.target.value }))}
                  placeholder="e.g. address the household by first name"
                  className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                />
              </label>

              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={generating}
                    onClick={() => generate(false)}
                    className="flex-1 rounded border border-amber-400 bg-amber-400/10 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-400/20 disabled:opacity-50"
                  >
                    {generating ? "Generating…" : markdown.trim() === "" ? "Generate" : "Regenerate"}
                  </button>
                  <button
                    type="button"
                    disabled={generating}
                    onClick={() => generate(true)}
                    title="Bypass cache and re-run the model"
                    className="rounded border border-slate-700 px-2 py-1.5 text-xs text-slate-300 hover:border-amber-400 disabled:opacity-50"
                  >
                    Force
                  </button>
                </div>
                <p
                  className="text-[11px] text-slate-400"
                  title={`Estimate · ${estimate.inputTokens.toLocaleString("en-US")} input + ${estimate.outputTokens.toLocaleString("en-US")} output · ${estimate.resolvedSourceCount} widget(s), ${estimate.uniquePlanCount} plan(s), ${estimate.totalYearRows} year row(s)`}
                >
                  Estimated cost: {formatTokenEstimate(estimate.totalTokens)}
                </p>
                {ai.lastGenerated && (
                  <p className="text-[11px] text-slate-400">
                    {ai.lastGenerated.cached ? "Cached · " : ""}generated {ai.lastGenerated.at.slice(0, 16).replace("T", " ")}
                  </p>
                )}
                {generateError && <p className="text-[11px] text-rose-300">{generateError}</p>}
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
