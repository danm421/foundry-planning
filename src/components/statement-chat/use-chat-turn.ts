import { useCallback, useState } from "react";
import type { ExcludedRow } from "@/components/statement-chat/excluded-rows";
import type { ExtractedAccount } from "@/lib/extraction/types";
import type { Annotated } from "@/lib/imports/types";
import type { ChatTurn } from "@/lib/statement-chat/state";

type Row = Annotated<ExtractedAccount>;

export type TurnStatus = "idle" | "sending" | "error";

interface TurnResponseBody {
  payload?: { accounts?: Row[] };
  summary?: string;
  excludedRows?: ExcludedRow<Row>[];
  turnEntries?: ChatTurn[];
}

export interface UseChatTurnArgs {
  clientId: string;
  importId: string;
  /** Appends this turn's own transcript delta — always the SERVER's
   *  `turnEntries` (C1), never a client-composed user/assistant string.
   *  Owned by `useChatCommit` (the same hydration source, per C2). */
  appendTurnEntries: (entries: ChatTurn[]) => void;
  /** Adopts the turn's row state into the surface BEFORE the returned
   *  promise resolves (brief Step 2) — must be `useChatCommit`'s own
   *  `adoptTurnPayload`, which is routed through its commit queue so a
   *  commit clicked right after can never read the pre-turn snapshot. */
  adoptTurnPayload: (accounts: Row[], excluded: ExcludedRow<Row>[], summary: string) => Promise<void>;
  /** Fired once adoption lands on a successful turn, so the caller can bring
   *  the extracted-state panel into view even when this is the very first
   *  thing this session has to show (a resumed draft's first follow-up). */
  onAdopted: () => void;
}

/**
 * Sends one statement-chat turn and adopts what comes back (Task 11b, Steps
 * 2/3). Split out of `chat-surface.tsx` the way `use-chat-commit.ts` was
 * (Task 10b) — this hook owns "POST + adopt + in-flight/error status" only;
 * `use-chat-commit.ts` still owns the row/commit state itself, the mount
 * hydration this hook's callers are built from, and the queue this hook's
 * adoption step serializes against.
 */
export function useChatTurn({
  clientId,
  importId,
  appendTurnEntries,
  adoptTurnPayload,
  onAdopted,
}: UseChatTurnArgs) {
  const [turnStatus, setTurnStatus] = useState<TurnStatus>("idle");
  const [turnError, setTurnError] = useState<string | null>(null);

  const sendTurn = useCallback(
    async (message: string): Promise<boolean> => {
      setTurnStatus("sending");
      setTurnError(null);
      try {
        const res = await fetch(`/api/clients/${clientId}/imports/${importId}/chat/turn`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message }),
        });
        if (!res.ok) {
          // Global Constraint: a non-2xx renders the server's own copy —
          // never a dead spinner (brief Step 3).
          const body = await res.json().catch(() => ({}) as { error?: string });
          const retryAfter = res.headers.get("retry-after");
          setTurnStatus("error");
          setTurnError(
            (body.error ?? `Could not send that (HTTP ${res.status}).`) +
              (retryAfter ? ` Retry in ${retryAfter}s.` : ""),
          );
          return false;
        }

        const body = (await res.json()) as TurnResponseBody;
        // Step 2, the load-bearing requirement: adopt BEFORE this resolves,
        // so a commit clicked the instant `sendTurn` returns can never read
        // a pre-turn row.
        await adoptTurnPayload(body.payload?.accounts ?? [], body.excludedRows ?? [], body.summary ?? "");
        onAdopted();
        // C1: append EXACTLY what the route returned. `turnEntries` already
        // carries the user's own message as its first element — never add it
        // again here.
        appendTurnEntries(body.turnEntries ?? []);
        setTurnStatus("idle");
        return true;
      } catch (err) {
        setTurnStatus("error");
        setTurnError(err instanceof Error ? err.message : "Could not reach the server.");
        return false;
      }
    },
    [clientId, importId, appendTurnEntries, adoptTurnPayload, onAdopted],
  );

  return { turnStatus, turnError, sendTurn };
}
