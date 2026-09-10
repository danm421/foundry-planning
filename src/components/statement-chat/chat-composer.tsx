"use client";

import { useState } from "react";
import { textareaBaseClassName } from "@/components/forms/input-styles";

export interface ChatComposerProps {
  /** Sends one turn. Resolves `true` on success — the composer clears its
   *  input — or `false` on failure, which restores what was typed so a
   *  failed send (rate limit, network blip) doesn't lose the advisor's
   *  question. */
  onSend: (message: string) => Promise<boolean>;
  /** Disables the whole composer for a reason OTHER than this composer's
   *  own in-flight request — e.g. an extraction stream is still open
   *  (Ruling 63: never send a turn over one). Deliberately NOT tied to
   *  whether any rows have been extracted (brief C3): an import with no
   *  extracted rows at all is a real state, and the turn route can still
   *  answer a question about it. */
  disabled: boolean;
  /** True only while THIS composer's own request is in flight — lets the
   *  button say "Sending…" rather than just "disabled for some reason". */
  sending: boolean;
}

/**
 * The chat input (Task 11b, Step 1). A single-line textarea + Send button;
 * Enter submits, Shift+Enter inserts a newline.
 */
export function ChatComposer({ onSend, disabled, sending }: ChatComposerProps) {
  const [value, setValue] = useState("");
  const isDisabled = disabled || sending;

  const submit = async () => {
    const message = value.trim();
    if (!message || isDisabled) return;
    setValue("");
    const ok = await onSend(message);
    if (!ok) setValue(message);
  };

  return (
    <form
      className="flex items-end gap-2 border-t border-hair p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <textarea
        aria-label="Ask a follow-up question"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
        disabled={isDisabled}
        placeholder="Ask a question about these statements…"
        rows={1}
        className={textareaBaseClassName + " flex-1 resize-none"}
      />
      <button
        type="submit"
        disabled={isDisabled || value.trim().length === 0}
        className="shrink-0 rounded bg-accent px-4 py-2 text-sm font-medium text-accent-on hover:bg-accent/90 disabled:opacity-50"
      >
        {sending ? "Sending…" : "Send"}
      </button>
    </form>
  );
}
