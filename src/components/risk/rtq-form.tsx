"use client";

import { useId, useState } from "react";
import { textareaClassName, fieldLabelClassName } from "@/components/forms/input-styles";
import type { RtqQuestion, RtqAnswers } from "@/lib/risk/rtq";

const ENVIRONMENT_NOTE_PROMPT =
  "Are there any circumstances in your life right now that make you want to take more or less investment risk than usual?";

interface RtqFormProps {
  questions: RtqQuestion[];
  onSubmit: (answers: RtqAnswers, environmentNote: string | undefined) => Promise<void>;
  showEnvironmentNote: boolean;
}

/**
 * The questionnaire itself -- one radio group per question, options in
 * declaration order, plus an optional free-text environment prompt. Owns its
 * own answer state and Submit button but stays fetch-free: the parent
 * supplies `onSubmit`, so this same component serves both the
 * advisor-administered dialog here and the public link route (Task 14)
 * without modification.
 */
export function RtqForm({ questions, onSubmit, showEnvironmentNote }: RtqFormProps) {
  const noteId = useId();
  const [answers, setAnswers] = useState<RtqAnswers>({});
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete = questions.every((q) => Boolean(answers[q.id]));

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(answers, note.trim().length > 0 ? note.trim() : undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      {questions.map((q) => (
        <fieldset key={q.id} className="space-y-2">
          <legend className="mb-1 text-[13px] font-medium text-ink-2">{q.prompt}</legend>
          <div className="space-y-1.5">
            {q.options.map((opt) => (
              <label key={opt.value} className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name={q.id}
                  value={opt.value}
                  checked={answers[q.id] === opt.value}
                  onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: opt.value }))}
                  className="mt-0.5 accent-accent"
                />
                <span className="text-[13px] text-ink">{opt.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {showEnvironmentNote && (
        <div>
          <label htmlFor={noteId} className={fieldLabelClassName}>
            {ENVIRONMENT_NOTE_PROMPT}
          </label>
          <textarea
            id={noteId}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className={textareaClassName}
            placeholder="Optional"
          />
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-crit">
          {error}
        </p>
      )}
      <div>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!complete || submitting}
          className="btn-primary h-8 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </div>
    </div>
  );
}
