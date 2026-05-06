// src/components/reports/widgets/ai-analysis.tsx
//
// Screen render for the aiAnalysis widget. Three modes — Generate (empty),
// View (rendered markdown + Edit / Regenerate actions), and Edit (raw
// textarea). Generation hits the /ai-analysis route; the response body
// flows back into the reducer via two custom window events
// (`foundry:ai-analysis-result`, `foundry:ai-analysis-edit`) listened to
// in `builder.tsx`. Custom-event bridge is the v1 pattern — refactor to a
// dispatch context if it spreads further than this widget.
//
// Markdown rendering is deliberately minimal: paragraphs (split on blank
// lines) and unordered lists (paragraphs whose lines start with `- `).
// The PDF render mirrors the same subset.

"use client";
import { useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";

function renderMarkdown(md: string): ReactNode {
  return md.split(/\n{2,}/).map((para, i) => {
    if (para.startsWith("- ")) {
      const items = para
        .split("\n")
        .map((line) => line.replace(/^-\s*/, ""))
        .filter((line) => line.length > 0);
      return (
        <ul key={i} className="list-disc pl-5 space-y-1 mb-3">
          {items.map((it, j) => (
            <li key={j}>{it}</li>
          ))}
        </ul>
      );
    }
    return (
      <p key={i} className="mb-3 whitespace-pre-wrap">
        {para}
      </p>
    );
  });
}

export function AiAnalysisRender({
  props,
  widgetId,
}: WidgetRenderProps<"aiAnalysis">) {
  const params = useParams<{ id: string; reportId: string }>();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const empty = !props.body;

  async function generate(force = false) {
    if (!params || !params.id || !params.reportId) return;
    if (!empty && !force && !window.confirm("Replace existing commentary?")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/clients/${params.id}/reports/${params.reportId}/ai-analysis`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            widgetId,
            scopes: props.scopes,
            tone: props.tone,
            length: props.length,
          }),
        },
      );
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
      const { body } = (await res.json()) as { body: string };
      window.dispatchEvent(
        new CustomEvent("foundry:ai-analysis-result", {
          detail: { widgetId, body },
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-5 bg-card-2 rounded-md border border-hair">
      {props.title && (
        <div className="text-[14px] text-ink mb-3">{props.title}</div>
      )}
      {error && (
        <div className="text-[12px] text-crit mb-3" role="alert">
          {error}
        </div>
      )}
      {empty ? (
        <button
          type="button"
          onClick={() => generate()}
          disabled={busy}
          className="h-9 px-4 rounded-md bg-accent text-paper font-medium text-[14px] disabled:opacity-50"
        >
          {busy ? "Generating…" : "Generate"}
        </button>
      ) : editing ? (
        <textarea
          autoFocus
          rows={Math.max(8, props.body.split("\n").length + 1)}
          defaultValue={props.body}
          onBlur={(e) => {
            window.dispatchEvent(
              new CustomEvent("foundry:ai-analysis-edit", {
                detail: { widgetId, body: e.target.value },
              }),
            );
            setEditing(false);
          }}
          className="w-full bg-card border border-hair rounded-md p-3 text-[13px] font-mono"
        />
      ) : (
        <>
          <div className="text-[14px] text-ink leading-relaxed">
            {renderMarkdown(props.body)}
          </div>
          <div className="flex gap-3 mt-4 text-[12px] font-mono">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-ink-3 hover:text-ink"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => generate(true)}
              disabled={busy}
              className="text-ink-3 hover:text-ink"
            >
              {busy ? "Regenerating…" : "Regenerate"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
