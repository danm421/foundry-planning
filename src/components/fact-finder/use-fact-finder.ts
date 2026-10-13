"use client";
// src/components/fact-finder/use-fact-finder.ts
// The screen's copy of the fact finder. An edit shows at once (the same pure
// applyOps the server runs) and goes to PATCH …/fact-finder in a debounced
// batch, one request at a time; the server's state is adopted on every reply.
// Imports only client-safe leaf modules from src/lib/fact-finder.
import { useEffect, useState } from "react";
import type { AutosaveState } from "@/components/forms/use-plan-settings-autosave";
import type {
  ConflictResponse,
  ErrorResponse,
  GetFactFinderResponse,
  PatchFactFinderBody,
  PatchFactFinderResponse,
} from "@/lib/fact-finder/api-types";
import { rebaseOps } from "@/lib/fact-finder/client-ops";
import { FactFinderOpError, applyOps, type ClientOp, type OpContext } from "@/lib/fact-finder/ops";
import type { FactFinderState } from "@/lib/fact-finder/types";
import { JSON_HEADERS, OFFLINE_MESSAGE, factFinderUrl, refusalText } from "./http";

/** How long the screen sits still before queued edits are sent. */
export const SAVE_DEBOUNCE_MS = 400;

const DROPPED_NOTICE =
  "Some of your edits weren't kept: the same values changed at the same time from a reading or the chat. Check them and edit again if needed.";

export interface FactFinderStore {
  /** What the screen shows: the server's state plus every edit not yet saved. */
  state: FactFinderState;
  status: AutosaveState;
  /** Why the last edit was refused, or why saving failed. */
  error: string | null;
  /** Set when edits were dropped because the same values changed underneath them. */
  notice: string | null;
  /** False = refused (`error` says why) and nothing was queued. */
  apply(ops: ClientOp[]): boolean;
  /** Takes a newer fact finder from a read, a chat reply or an undo; unsaved edits are re-applied on it. */
  adopt(fresh: FactFinderState): void;
  /** Saves now. True = nothing is left unsaved. */
  flushNow(): Promise<boolean>;
  /** Fetches the saved fact finder and adopts it; a failed fetch changes nothing. */
  refresh(): Promise<void>;
  retry(): void;
  /** Clears a refusal and the notice. */
  dismiss(): void;
}

function advisorContext(): OpContext {
  return { by: "advisor", now: new Date().toISOString(), newId: () => crypto.randomUUID() };
}

interface Display {
  setState(state: FactFinderState): void;
  setStatus(status: AutosaveState): void;
  setFailure(message: string | null): void;
  setRefusal(message: string | null): void;
  setNotice(message: string | null): void;
}

type Outcome = "ok" | "refused" | "failed";

function createSync(url: string, initialState: FactFinderState, show: Display) {
  /** The last state the server confirmed. */
  let server = initialState;
  /** Unsaved edits in order. A batch stays at the front until its reply lands, so a failed send loses nothing. */
  let queue: ClientOp[] = [];
  let view = initialState;
  let sending: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failed = false;

  function render() {
    view = applyOps(server, queue, advisorContext());
    show.setState(view);
  }

  /** Moves to a newer server state and re-applies the queue on it; edits whose ground moved are dropped. */
  function moveTo(next: FactFinderState, madeAgainst: FactFinderState) {
    const { kept, dropped } = rebaseOps(queue, madeAgainst, next, advisorContext());
    server = next;
    queue = kept;
    if (dropped.length > 0) show.setNotice(DROPPED_NOTICE);
    render();
  }

  function adopt(fresh: FactFinderState) {
    if (fresh.version > server.version) moveTo(fresh, server);
  }

  function forget(batch: readonly ClientOp[]) {
    const sent = new Set(batch);
    queue = queue.filter((op) => !sent.has(op));
  }

  async function resync() {
    try {
      const res = await fetch(url);
      if (res.ok) adopt(((await res.json()) as GetFactFinderResponse).factFinder);
    } catch {
      // The next save, read or reply brings the screen up to date.
    }
  }

  async function attempt(batch: ClientOp[], base: FactFinderState): Promise<Outcome> {
    let res: Response;
    try {
      const body: PatchFactFinderBody = { baseVersion: base.version, ops: batch };
      res = await fetch(url, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(body) });
    } catch {
      show.setFailure(OFFLINE_MESSAGE);
      return "failed";
    }
    const body: unknown = await res.json().catch(() => ({}));
    if (res.ok) {
      forget(batch);
      // An adopted state can be newer than this reply; either way the batch is in it.
      const fresh = (body as PatchFactFinderResponse).factFinder;
      const next = fresh.version > server.version ? fresh : server;
      moveTo(next, next);
      return "ok";
    }
    if (res.status === 409) {
      adopt((body as ConflictResponse).factFinder);
      return "ok";
    }
    const message = (body as Partial<ErrorResponse>).error;
    if (res.status === 400) {
      forget(batch);
      show.setRefusal(message ?? "That edit wasn't accepted.");
      moveTo(server, server);
      await resync();
      return "refused";
    }
    show.setFailure(refusalText(res, message, "Couldn't save"));
    return "failed";
  }

  function send(): Promise<void> {
    if (sending) return sending;
    if (queue.length === 0) return Promise.resolve();
    failed = false;
    show.setFailure(null);
    show.setStatus("saving");
    sending = attempt(queue.slice(), server).then((outcome) => {
      sending = null;
      failed = outcome === "failed";
      if (failed) show.setStatus("error");
      else if (queue.length > 0) {
        // Edits made while this was in flight; a pending debounce sends them itself.
        if (!timer) void send();
      } else show.setStatus(outcome === "ok" ? "saved" : "idle");
    });
    return sending;
  }

  function cancelTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function apply(ops: ClientOp[]): boolean {
    let next: FactFinderState;
    try {
      next = applyOps(view, ops, advisorContext());
    } catch (err) {
      if (!(err instanceof FactFinderOpError)) throw err;
      show.setRefusal(err.message);
      return false;
    }
    // Copies, so each queued edit is its own object: a reply removes exactly the edits it carried.
    queue = [...queue, ...ops.map((op) => ({ ...op }))];
    view = next;
    show.setState(next);
    show.setRefusal(null);
    cancelTimer();
    timer = setTimeout(() => {
      timer = null;
      void send();
    }, SAVE_DEBOUNCE_MS);
    return true;
  }

  async function flushNow(): Promise<boolean> {
    cancelTimer();
    failed = false;
    while (!failed && (sending || queue.length > 0)) await (sending ?? send());
    return queue.length === 0;
  }

  /**
   * The page is going away (or into the back/forward cache): the browser
   * delivers what's unsaved. Safe beside a request in flight — both carry the
   * same base version, so at most one of them lands.
   */
  function sendOnExit() {
    if (queue.length === 0) return;
    const body: PatchFactFinderBody = { baseVersion: server.version, ops: queue };
    void fetch(url, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(body), keepalive: true }).catch(
      () => {},
    );
  }

  return {
    apply,
    adopt,
    flushNow,
    refresh: resync,
    retry() {
      cancelTimer();
      void send();
    },
    dismiss() {
      show.setRefusal(null);
      show.setNotice(null);
    },
    sendOnExit,
    dispose() {
      cancelTimer();
      sendOnExit();
    },
  };
}

export function useFactFinder({
  clientId,
  importId,
  initialState,
}: {
  clientId: string;
  importId: string;
  initialState: FactFinderState;
}): FactFinderStore {
  const [state, setState] = useState(initialState);
  const [status, setStatus] = useState<AutosaveState>("idle");
  const [failure, setFailure] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sync] = useState(() =>
    createSync(factFinderUrl(clientId, importId), initialState, {
      setState,
      setStatus,
      setFailure,
      setRefusal,
      setNotice,
    }),
  );

  useEffect(() => {
    const onPageHide = () => sync.sendOnExit();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      sync.dispose();
    };
  }, [sync]);

  return {
    state,
    status,
    error: failure ?? refusal,
    notice,
    apply: sync.apply,
    adopt: sync.adopt,
    flushNow: sync.flushNow,
    refresh: sync.refresh,
    retry: sync.retry,
    dismiss: sync.dismiss,
  };
}
