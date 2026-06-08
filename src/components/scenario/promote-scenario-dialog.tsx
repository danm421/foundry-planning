"use client";

import { useEffect, useRef, useState } from "react";
import { inputClassName } from "@/components/forms/input-styles";

interface PromoteScenarioDialogProps {
  scenarioName: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Typed-confirmation modal for promoting a scenario to the base case.
 * The Promote button is armed only when the user types the scenario name
 * exactly, and is also disabled while `busy` (fetch in flight).
 */
export function PromoteScenarioDialog({
  scenarioName,
  busy,
  onCancel,
  onConfirm,
}: PromoteScenarioDialogProps) {
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const armed = typed.trim() === scenarioName.trim() && !busy;

  // Auto-focus the input when the dialog mounts.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Escape-to-cancel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-paper/70 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />

      {/* Surface */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Promote to base case"
        className="relative z-10 w-full max-w-[480px] flex flex-col rounded-[var(--radius)] bg-card border-2 border-ink-3 ring-1 ring-black/60 shadow-2xl outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-6 pt-4 pb-4 border-b border-hair">
          <h2 className="text-[16px] font-semibold text-ink">
            Promote to base case
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded text-ink-3 hover:text-ink hover:bg-card-hover"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden
            >
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 pt-6 pb-6">
          <p className="text-[14px] text-ink-2 leading-relaxed">
            Promoting{" "}
            <span className="font-medium text-ink">{scenarioName}</span> will
            replace this client&apos;s base case with the scenario&apos;s
            changes. A snapshot of the current base case is saved first.{" "}
            <span className="font-medium text-crit">
              All other scenarios will be permanently deleted.
            </span>
          </p>

          <p className="mt-4 text-[13px] text-ink-3">
            To confirm, type{" "}
            <span className="font-medium text-ink">{scenarioName}</span> below:
          </p>
          <input
            ref={inputRef}
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={scenarioName}
            className={`${inputClassName} mt-2`}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-hair">
          <button
            type="button"
            onClick={onConfirm}
            disabled={!armed}
            className="rounded-[var(--radius-sm)] px-4 h-9 text-[13px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-crit hover:bg-card-hover"
          >
            {busy ? "Promoting…" : "Promote to base case"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[var(--radius-sm)] px-4 h-9 text-[13px] font-medium transition-colors text-ink-2 hover:text-ink hover:bg-card-hover border border-transparent hover:border-hair"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
