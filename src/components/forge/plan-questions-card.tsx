// src/components/forge/plan-questions-card.tsx
//
// Presentational card listing unanswered AssembleQuestions from a plan-build
// assemble step. Structure + styling mirror MeetingReviewCard. Local state
// only — the panel owns the network call (submitPlanAnswers).
"use client";
import { useState } from "react";
import type { AssembleQuestion } from "@/lib/imports/assemble/types";

interface PlanQuestionsCardProps {
  /** Unanswered questions only — render nothing if empty. */
  questions: AssembleQuestion[];
  busy: boolean;
  /** question.id -> answer text (non-empty answers only). */
  onSubmit: (answers: Record<string, string>) => void;
  /** Dismiss the card, leaving assumption defaults in place. */
  onSkip: () => void;
}

export function PlanQuestionsCard({ questions, busy, onSubmit, onSkip }: PlanQuestionsCardProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});

  if (questions.length === 0) return null;

  function patch(id: string, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  const hasAnswer = Object.values(answers).some((v) => v.trim() !== "");

  function submit() {
    const nonEmpty: Record<string, string> = {};
    for (const [id, value] of Object.entries(answers)) {
      if (value.trim() !== "") nonEmpty[id] = value.trim();
    }
    onSubmit(nonEmpty);
  }

  return (
    <div
      data-testid="forge-plan-questions"
      className="rounded-[var(--radius)] border border-hair bg-card-2/40"
    >
      {/* Header */}
      <div className="border-b border-hair px-4 py-2.5 text-[12px] font-medium text-ink-2">
        A few things to confirm — <span className="tabular">{questions.length}</span> question
        {questions.length === 1 ? "" : "s"}
      </div>

      {/* Body */}
      <div className="space-y-3 px-4 py-3">
        {questions.map((q) => (
          <div key={q.id} className="space-y-1">
            <label htmlFor={`plan-question-${q.id}`} className="block text-[11px] font-medium text-ink-3">
              {q.prompt}
            </label>
            {q.options && q.options.length > 0 ? (
              <select
                id={`plan-question-${q.id}`}
                value={answers[q.id] ?? ""}
                disabled={busy}
                onChange={(e) => patch(q.id, e.target.value)}
                className="w-full rounded-[var(--radius-sm)] border border-hair bg-card px-2 py-1 text-[13px] text-ink disabled:opacity-50"
              >
                <option value=""></option>
                {q.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`plan-question-${q.id}`}
                value={answers[q.id] ?? ""}
                disabled={busy}
                onChange={(e) => patch(q.id, e.target.value)}
                className="w-full rounded-[var(--radius-sm)] border border-hair bg-card px-2 py-1 text-[13px] text-ink disabled:opacity-50"
              />
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 border-t border-hair px-4 py-3">
        <span className="flex-1" />
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          className="rounded-[var(--radius-sm)] border border-hair px-2.5 py-1 text-[12px] text-ink-3 hover:text-ink disabled:opacity-50"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy || !hasAnswer}
          className="rounded-[var(--radius-sm)] bg-accent px-3 py-1 text-[12px] font-semibold text-accent-on hover:bg-accent-ink disabled:opacity-50"
        >
          Submit answers
        </button>
      </div>
    </div>
  );
}
