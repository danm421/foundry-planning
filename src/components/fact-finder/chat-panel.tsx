"use client";
// src/components/fact-finder/chat-panel.tsx
// The chat part of the side panel: the conversation and its composer. What is
// in flight lives in `useWorksheetChat`; the screen holds it, so a reply still
// lands while the panel is closed.
// Imports only client-safe leaf modules from src/lib/fact-finder.
import { ChatComposer } from "@/components/fact-finder/chat-composer";
import type { FactFinderState } from "@/lib/fact-finder/types";
import { ChatTranscript } from "./chat-transcript";
import { AlertIcon } from "./icons";
import type { WorksheetChat } from "./use-worksheet-chat";

const HEADING_ID = "fact-finder-chat";
const READING_REASON = "Still reading your documents — you can ask once that finishes.";

/** The conversation, under the documents in the panel's scrolling body. */
export function ChatPanel({ chat, state }: { chat: WorksheetChat; state: FactFinderState }) {
  return (
    <section aria-labelledby={HEADING_ID} className="flex flex-col gap-3 border-t border-hair p-4">
      <h3 id={HEADING_ID} className="text-xs font-semibold uppercase tracking-wide text-ink-3">
        Chat
      </h3>
      <ChatTranscript
        transcript={state.transcript}
        undoable={state.undo}
        pending={chat.pending}
        progress={chat.progress}
        undoing={chat.undoing}
        onUndo={(turnId) => void chat.undo(turnId)}
        renderProposal={() => null}
      />
    </section>
  );
}

/** The composer, pinned at the bottom of the panel, with why it can't send. */
export function ChatComposerBar({ chat, reading }: { chat: WorksheetChat; reading: boolean }) {
  return (
    <div>
      <ChatComposer
        onSend={chat.send}
        disabled={reading || chat.undoing !== null}
        sending={chat.pending !== null}
        placeholder="Ask for a table, a fix, or a plan update."
        ariaLabel="Chat message"
      />
      {(reading || chat.error) && (
        <div className="flex flex-col gap-2 px-3 pb-3">
          {chat.error && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-crit/30 bg-crit/15 px-3 py-2 text-sm text-crit"
            >
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">{chat.error}</span>
            </p>
          )}
          {reading && <p className="text-xs text-ink-3">{READING_REASON}</p>}
        </div>
      )}
    </div>
  );
}
