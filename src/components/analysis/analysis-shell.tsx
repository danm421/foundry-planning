"use client";

import type { ReactNode } from "react";

export interface AnalysisShellProps {
  title: string;
  asOfLabel: string;
  clientNames: string;
  steps: string[];
  view: "summary" | "probability";
  onViewChange: (view: "summary" | "probability") => void;
  onClose?: () => void;
  footer?: ReactNode;
  children: ReactNode;
}

export function AnalysisShell({
  title,
  asOfLabel,
  clientNames,
  steps,
  view,
  onViewChange,
  onClose,
  footer,
  children,
}: AnalysisShellProps) {
  return (
    <div className="flex min-h-0 flex-col">
      {/* Header band */}
      <div className="flex items-center justify-between gap-4 border-b border-hair bg-card px-[var(--pad-card)] py-3">
        <div className="flex min-w-0 items-center gap-2 text-[13px]">
          <span className="font-semibold text-ink">{title}</span>
          <span className="text-ink-4" aria-hidden="true">
            &middot;
          </span>
          <span className="text-ink-2">{asOfLabel}</span>
          <span className="text-ink-4" aria-hidden="true">
            &middot;
          </span>
          <span className="truncate text-ink-3">{clientNames}</span>
        </div>
        {onClose != null && (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-[var(--radius-sm)] border border-transparent px-3 py-1 text-[12px] font-medium text-ink-2 transition-colors duration-150 hover:border-hair hover:bg-card-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Close
          </button>
        )}
      </div>

      {/* Breadcrumb wizard */}
      <div
        className="flex items-center gap-1 border-b border-hair bg-paper px-[var(--pad-card)] py-2 text-[12px]"
        aria-label="Progress steps"
      >
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1;
          return (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && (
                <span className="select-none text-ink-4" aria-hidden="true">
                  &rarr;
                </span>
              )}
              <span className={isLast ? "font-medium text-ink" : "text-ink-4"}>
                {step}
              </span>
            </span>
          );
        })}
      </div>

      {/* Segmented view toggle */}
      <div className="flex items-center gap-3 border-b border-hair bg-paper px-[var(--pad-card)] py-2">
        <div
          role="group"
          aria-label="View"
          className="flex items-center gap-0.5 rounded border border-hair bg-card p-0.5"
        >
          <button
            type="button"
            aria-pressed={view === "summary"}
            onClick={() => onViewChange("summary")}
            className={`rounded-[calc(var(--radius-sm)-2px)] px-3 py-1 text-[12px] font-medium transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
              view === "summary"
                ? "bg-accent text-accent-on"
                : "cursor-pointer text-ink-3 hover:bg-card-hover hover:text-ink"
            }`}
          >
            Summary
          </button>
          <button
            type="button"
            aria-pressed={view === "probability"}
            onClick={() => onViewChange("probability")}
            className={`rounded-[calc(var(--radius-sm)-2px)] px-3 py-1 text-[12px] font-medium transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
              view === "probability"
                ? "bg-accent text-accent-on"
                : "cursor-pointer text-ink-3 hover:bg-card-hover hover:text-ink"
            }`}
          >
            Probability of Success
          </button>
        </div>
      </div>

      {/* Analysis content */}
      <div className="min-h-0 flex-1">{children}</div>

      {/* Footer band */}
      {footer != null && (
        <div className="border-t border-hair bg-card px-[var(--pad-card)] py-3">
          {footer}
        </div>
      )}
    </div>
  );
}
