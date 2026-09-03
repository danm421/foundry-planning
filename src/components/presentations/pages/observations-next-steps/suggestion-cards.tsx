"use client";
import { MarkdownMessage } from "@/components/forge/markdown-message";
import { renderTokens } from "@/lib/plan-text/tokens";
import { TOPIC_LABELS } from "@/lib/schemas/observations";
import type { DraftSuggestion } from "./use-draft-run";

interface Props {
  suggestions: DraftSuggestion[];
  tokenValues: Record<string, string | null> | null;
  onAccept: (idx: number) => void;
  onEditAccept: (idx: number) => void;
  onDismiss: (idx: number) => void;
  onAcceptAll: () => void;
}

const TOKEN_PATTERN = /\{\{[a-z0-9_]+\}\}/g;
const accept = "rounded border border-accent bg-accent/10 px-2.5 py-1 text-[12px] font-medium text-accent hover:bg-accent/20";
const quiet = "rounded border border-hair px-2.5 py-1 text-[12px] font-medium text-ink-2 hover:border-accent hover:text-accent";

export function SuggestionCards({ suggestions, tokenValues, onAccept, onEditAccept, onDismiss, onAcceptAll }: Props) {
  if (suggestions.length === 0) return null;
  const render = (body: string) =>
    tokenValues === null ? body.replace(TOKEN_PATTERN, "…") : renderTokens(body, tokenValues);
  return (
    <section className="rounded-lg border border-accent/40 bg-accent-wash p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] text-ink-3">
          <span className="chip chip-accent mr-2">AI draft</span>
          {suggestions.length} suggestion{suggestions.length === 1 ? "" : "s"} — review before adding
        </span>
        <button type="button" className={accept} onClick={onAcceptAll}>
          Accept all
        </button>
      </div>
      <ul className="flex flex-col gap-2">
        {suggestions.map((s, idx) => (
          <li key={idx} className="rounded-lg border border-hair bg-card p-3">
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-ink-3">
              {TOPIC_LABELS[s.topic]}
              {s.owner && ` · ${s.owner}`}
              {s.priority && ` · ${s.priority} priority`}
            </div>
            {s.title && <p className="mb-1 text-[13px] font-semibold text-ink">{s.title}</p>}
            <MarkdownMessage text={render(s.body)} />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" className={accept} onClick={() => onAccept(idx)}>Accept</button>
              <button type="button" className={quiet} onClick={() => onEditAccept(idx)}>Edit &amp; accept</button>
              <button type="button" className="rounded px-2.5 py-1 text-[12px] font-medium text-ink-3 hover:text-ink" onClick={() => onDismiss(idx)}>
                Dismiss
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
