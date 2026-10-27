"use client";
// src/components/fact-finder/use-worksheet-chat.ts
// The worksheet chat: a message — or a compose, which folds newly read
// documents into the worksheet — goes to POST …/fact-finder/turn, which
// answers with server-sent frames: a progress line per tool call, then the
// finished fact finder. A reply's Undo goes to POST …/fact-finder/undo.
// One request at a time. The screen holds this, so a reply still lands while
// the panel is closed.
import { useRef, useState } from "react";
import type {
  ConflictResponse,
  ErrorResponse,
  TurnBody,
  TurnFrame,
  UndoBody,
  UndoResponse,
} from "@/lib/fact-finder/api-types";
import type { FactFinderState } from "@/lib/fact-finder/types";
import { JSON_HEADERS, OFFLINE_MESSAGE, factFinderUrl, refusalText } from "./http";
import { parseSse } from "./sse";

const ENDED_EARLY_MESSAGE = "The reply stopped before it finished. Try again.";

export interface WorksheetChat {
  /** The advisor's message on its way ("" for a compose, which has none to show); null when nothing is running. */
  pending: string | null;
  /** This reply's tool lines so far. */
  progress: string[];
  /** The reply being undone. */
  undoing: string | null;
  /** Why the last message or Undo didn't go through. */
  error: string | null;
  /**
   * True = sent and its reply adopted; false = not sent or it failed (`error` says why) and the composer keeps the text.
   * `match`: the message is a "Match to plan" (`TurnBody`).
   */
  send(message: string, match?: TurnBody["match"]): Promise<boolean>;
  /**
   * Starts folding every document read but not yet composed into the worksheet; nothing shows when nothing comes
   * back changed. False = it didn't start, because a reply or an Undo is running; true = it started, and how it ends
   * shows like any reply's.
   */
  compose(): boolean;
  undo(turnId: string): Promise<void>;
}

export function useWorksheetChat({
  clientId,
  importId,
  adopt,
}: {
  clientId: string;
  importId: string;
  adopt: (fresh: FactFinderState) => void;
}): WorksheetChat {
  const [pending, setPending] = useState<string | null>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const url = factFinderUrl(clientId, importId);

  /** A refusal before any stream, in the route's own words. Another tab saving the import hands the screen the saved fact finder. */
  async function refuse(res: Response, failed: string) {
    const body = (await res.json().catch(() => ({}))) as Partial<ErrorResponse & ConflictResponse>;
    if (res.status === 409 && body.factFinder) adopt(body.factFinder);
    setError(refusalText(res, body.error, failed));
  }

  /** One turn, start to finish. True = its fact finder was adopted. Never throws. */
  async function turn(body: TurnBody, shown: string): Promise<boolean> {
    if (busy.current) return false;
    busy.current = true;
    setError(null);
    setProgress([]);
    setPending(shown);
    try {
      let res: Response;
      try {
        res = await fetch(`${url}/turn`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
      } catch {
        setError(OFFLINE_MESSAGE);
        return false;
      }
      if (!res.ok || !res.body) {
        await refuse(res, "Couldn't send that");
        return false;
      }

      let ending: "done" | "error" | null = null;
      try {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = parseSse<TurnFrame>(buffer);
          let next = frames.next();
          while (!next.done) {
            const frame = next.value;
            if (frame.type === "progress") {
              setProgress((lines) => [...lines, frame.line]);
            } else if (frame.type === "done") {
              ending = "done";
              adopt(frame.factFinder);
            } else {
              ending = "error";
              if (frame.factFinder) adopt(frame.factFinder);
              setError(frame.message);
            }
            next = frames.next();
          }
          buffer = next.value;
        }
      } catch {
        // The connection dropped: handled below as a reply that stopped early.
      }
      if (ending === null) setError(ENDED_EARLY_MESSAGE);
      return ending === "done";
    } finally {
      busy.current = false;
      setPending(null);
      setProgress([]);
    }
  }

  const send = (message: string, match?: TurnBody["match"]) => turn({ message, ...(match && { match }) }, message);

  function compose(): boolean {
    if (busy.current) return false;
    void turn({ mode: "compose" }, "");
    return true;
  }

  async function undo(turnId: string): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    setUndoing(turnId);
    try {
      let res: Response;
      try {
        const body: UndoBody = { turnId };
        res = await fetch(`${url}/undo`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
      } catch {
        setError(OFFLINE_MESSAGE);
        return;
      }
      if (!res.ok) {
        await refuse(res, "Couldn't undo that");
        return;
      }
      const answer = (await res.json().catch(() => null)) as UndoResponse | null;
      if (answer?.factFinder) adopt(answer.factFinder);
    } finally {
      busy.current = false;
      setUndoing(null);
    }
  }

  return { pending, progress, undoing, error, send, compose, undo };
}
