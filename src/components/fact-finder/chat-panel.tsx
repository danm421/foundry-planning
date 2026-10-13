"use client";
// src/components/fact-finder/chat-panel.tsx
// The chat part of the side panel. A message goes to POST …/fact-finder/turn,
// which edits the fact finder through the same ops as the screen; a reply's
// Undo goes to POST …/fact-finder/undo. Both save the advisor's typed edits
// first and adopt the fact finder they answer with. `useChat` keeps what is in
// flight; the screen holds it, so a reply still lands while the panel is closed.
// Imports only client-safe leaf modules from src/lib/fact-finder.
import { useState } from "react";
import { ChatComposer } from "@/components/statement-chat/chat-composer";
import type { ErrorResponse, TurnBody, TurnResponse, UndoBody, UndoResponse } from "@/lib/fact-finder/api-types";
import type { FactFinderState } from "@/lib/fact-finder/types";
import { ChatTranscript } from "./chat-transcript";
import { JSON_HEADERS, OFFLINE_MESSAGE, factFinderUrl, refusalText } from "./http";
import { AlertIcon } from "./icons";

const HEADING_ID = "fact-finder-chat";
const UNSAVED_MESSAGE = "Your latest edits haven't saved yet — try again once they're saved.";
const READING_REASON = "Still reading your documents — you can ask once that finishes.";

export interface Chat {
  /** The message on its way, shown until its reply lands. */
  pending: string | null;
  /** The reply being undone. */
  undoing: string | null;
  /** Why the last message or Undo didn't go through. */
  error: string | null;
  /** True = sent and its reply adopted; false = not sent (`error` says why) and the composer keeps the text. */
  send(message: string): Promise<boolean>;
  undo(turnId: string): Promise<void>;
}

export function useChat({
  clientId,
  importId,
  flushNow,
  adopt,
}: {
  clientId: string;
  importId: string;
  /** Saves the advisor's typed edits; true = nothing is left unsaved. */
  flushNow: () => Promise<boolean>;
  adopt: (fresh: FactFinderState) => void;
}): Chat {
  const [pending, setPending] = useState<string | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = factFinderUrl(clientId, importId);

  /** The route's answer, or null once `error` says why there isn't one. */
  async function post<T>(route: "turn" | "undo", body: TurnBody | UndoBody, failed: string): Promise<T | null> {
    let res: Response;
    try {
      res = await fetch(`${url}/${route}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
    } catch {
      setError(OFFLINE_MESSAGE);
      return null;
    }
    const answer: unknown = await res.json().catch(() => ({}));
    if (res.ok) return answer as T;
    setError(refusalText(res, (answer as Partial<ErrorResponse>).error, failed));
    return null;
  }

  async function send(message: string): Promise<boolean> {
    setError(null);
    setPending(message);
    try {
      // The reply works from what the screen shows, so typed edits are saved first.
      if (!(await flushNow())) {
        setError(UNSAVED_MESSAGE);
        return false;
      }
      const answer = await post<TurnResponse>("turn", { message }, "Couldn't send that");
      if (!answer) return false;
      adopt(answer.factFinder);
      return true;
    } finally {
      setPending(null);
    }
  }

  async function undo(turnId: string): Promise<void> {
    setError(null);
    setUndoing(turnId);
    try {
      // The server refuses when a row the reply touched has changed since, so it must see every typed edit.
      if (!(await flushNow())) {
        setError(UNSAVED_MESSAGE);
        return;
      }
      const answer = await post<UndoResponse>("undo", { turnId }, "Couldn't undo that");
      if (answer) adopt(answer.factFinder);
    } finally {
      setUndoing(null);
    }
  }

  return { pending, undoing, error, send, undo };
}

/** The conversation, under the documents in the panel's scrolling body. */
export function ChatPanel({ chat, state }: { chat: Chat; state: FactFinderState }) {
  return (
    <section aria-labelledby={HEADING_ID} className="flex flex-col gap-3 border-t border-hair p-4">
      <h3 id={HEADING_ID} className="text-xs font-semibold uppercase tracking-wide text-ink-3">
        Chat
      </h3>
      <ChatTranscript
        transcript={state.transcript}
        undoable={state.undo}
        pending={chat.pending}
        undoing={chat.undoing}
        onUndo={(turnId) => void chat.undo(turnId)}
      />
    </section>
  );
}

/** The composer, pinned at the bottom of the panel, with why it can't send. */
export function ChatComposerBar({ chat, reading }: { chat: Chat; reading: boolean }) {
  return (
    <div>
      <ChatComposer
        onSend={chat.send}
        disabled={reading || chat.undoing !== null}
        sending={chat.pending !== null}
        placeholder="Ask, or say what to change…"
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
