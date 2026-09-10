import { useCallback, useEffect, useState } from "react";
import type { ExcludedRow } from "@/components/statement-chat/excluded-rows";
import type { ExtractedAccount } from "@/lib/extraction/types";
import type { Annotated } from "@/lib/imports/types";
import { readChatState, writeChatState } from "@/lib/statement-chat/state";

type Row = Annotated<ExtractedAccount>;

export interface ChatCommitResult {
  summary: string;
  caveats: string[];
  rows: Row[];
  excluded: ExcludedRow<Row>[];
}

export type FinalizeStatus = "idle" | "pending" | "done" | "error";

/**
 * Read the import's persisted `payloadJson` (the same GET the drafts list
 * and the wizard drawer use). Used both to hydrate `committedRowIds` on
 * mount (a reload/resume must not forget what was already locked — brief
 * Step 2) and, immediately before every `writeChatState` call, so that
 * write only ever merges onto the FRESHEST server state (Ruling 63 —
 * `chat/extract/route.ts`'s own re-extraction can rewrite `decisions` /
 * `excludedRows` between one commit and the next, and this hook has no
 * other way to learn that happened).
 */
async function readImportPayloadJson(clientId: string, importId: string): Promise<unknown> {
  const res = await fetch(`/api/clients/${clientId}/imports/${importId}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error ?? `Could not load the import (HTTP ${res.status}).`);
  }
  const body = (await res.json()) as { import?: { payloadJson?: unknown } };
  return body.import?.payloadJson;
}

/**
 * PATCH `payloadJson`. The route shallow-merges at the TOP level only
 * (`{...existing, ...payloadJson}`) — it replaces a named key wholesale
 * rather than deep-merging it — so a caller must always pass a COMPLETE
 * value for any key it names (never a partial `chat` or `payload`).
 */
async function patchImportPayloadJson(
  clientId: string,
  importId: string,
  payloadJson: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`/api/clients/${clientId}/imports/${importId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ payloadJson }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error ?? `Could not save (HTTP ${res.status}).`);
  }
}

/**
 * Owns everything downstream of a completed extraction: the working table
 * (`result`), which rows are locked (`committedRowIds`), and closing the
 * import. Split out of `chat-surface.tsx` (Task 10b) once that file's own
 * commit/edit/restore/finalize wiring pushed it well past 300 lines —
 * `runExtraction`'s SSE plumbing stays there; this is the review-and-commit
 * half.
 */
export function useChatCommit(clientId: string, importId: string) {
  const [result, setResult] = useState<ChatCommitResult | null>(null);
  const [committedRowIds, setCommittedRowIds] = useState<string[]>([]);
  const [finalizeStatus, setFinalizeStatus] = useState<FinalizeStatus>("idle");
  const [finalizeError, setFinalizeError] = useState<string | null>(null);

  // Hydrate `committedRowIds` from the persisted chat state on mount, so a
  // reload (or resuming a chat import from the drafts list) shows a row
  // already committed in an earlier session as locked instead of
  // re-committable (brief Step 2, "survives a reload").
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const payloadJson = await readImportPayloadJson(clientId, importId);
        if (!cancelled) setCommittedRowIds(readChatState(payloadJson).committedRowIds);
      } catch (err) {
        // Best-effort hydration: a failed read just means rows show as
        // not-yet-committed until the first successful commit repopulates
        // this list — not a mutation, so nothing to surface as an error.
        console.error("Could not load this import's committed rows:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, importId]);

  // Called at the start of a (re-)extraction run, so a stale table and a
  // stale finalize state from a previous run don't linger under a fresh
  // streaming pass.
  const resetForNewExtraction = useCallback(() => {
    setResult(null);
    setFinalizeStatus("idle");
    setFinalizeError(null);
  }, []);

  // Called when the extraction stream's "done" event lands.
  //
  // Re-extraction (appending a new file) re-merges EVERY row fresh from
  // `fileResults`, which carries no memory of an earlier commit —
  // `mergeAcrossFiles` always emits `match: {kind: "new"}` (Task 1-6).
  // Carry forward `match: "exact"` for any `__rowId` this hook already
  // knows was linked, or the NEXT commit's payload PATCH (below) would
  // re-persist an already-committed row as brand new and reopen the
  // duplicate-insert hole `linkCreated` exists to close.
  const applyExtractionResult = useCallback((ev: ChatCommitResult) => {
    setResult((prev) => {
      const priorByRowId = new Map((prev?.rows ?? []).map((r) => [r.__rowId, r]));
      return {
        ...ev,
        rows: ev.rows.map((row) => {
          const prior = row.__rowId ? priorByRowId.get(row.__rowId) : undefined;
          return prior?.match?.kind === "exact" ? { ...row, match: prior.match } : row;
        }),
      };
    });
  }, []);

  // `onCommitRows` (AccountsTable → EntityTable's per-row Commit button).
  // Two things have to happen server-side before the shared commit route
  // will do anything: (1) `payloadJson.payload.accounts` has to exist at
  // all — `chat/extract/route.ts` only ever streams `kept` to the client,
  // it never persists it as `payload` (that's the wizard's `/match` step,
  // which this surface doesn't run) — and (2) it has to be the CURRENT view
  // of every row, or a row committed earlier in this session gets
  // re-persisted as `{kind: "new"}` and the next commit of THAT row would
  // duplicate-insert it. `result.rows` already satisfies both: it holds
  // every row the table shows, and it's kept current by `applyExtractionResult`
  // above and by adopting each commit response below.
  const handleCommitRows = useCallback(
    async (rowIds: string[]) => {
      if (!result) return;

      await patchImportPayloadJson(clientId, importId, {
        payload: { accounts: result.rows },
      });

      const res = await fetch(`/api/clients/${clientId}/imports/${importId}/commit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // `tabs` MUST be present alongside `rowIds` — `rowIds` is honoured
        // only by `commitAccounts`, so naming any tab besides "accounts"
        // here would commit that other tab completely unfiltered.
        body: JSON.stringify({ tabs: ["accounts"], rowIds }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        const retryAfter = res.headers.get("retry-after");
        throw new Error(
          (body.error ?? `Commit failed (HTTP ${res.status}).`) +
            (retryAfter ? ` Retry in ${retryAfter}s.` : ""),
        );
      }

      // Adopt the mutated payload the commit route just persisted — it
      // carries the `linkCreated` stamp `commitAccounts` made for the row(s)
      // just committed, so the NEXT commit's payload PATCH (above) doesn't
      // regress them back to "new" (same convention review-wizard.tsx
      // documents at its own commit response handler).
      const body = (await res.json()) as { payload?: { accounts?: Row[] } };
      const nextRows = body.payload?.accounts;
      if (nextRows) {
        setResult((prev) => (prev ? { ...prev, rows: nextRows } : prev));
      }

      // Lock the row in the UI regardless of whether the bookkeeping write
      // below succeeds — the account itself is already committed.
      setCommittedRowIds((prev) => Array.from(new Set([...prev, ...rowIds])));

      // Persist the lock so it survives a reload (brief Step 2). Read fresh
      // immediately before writing (Ruling 63): a re-extraction could have
      // changed `chat.decisions` / `excludedRows` server-side since this
      // hook last read them, and `writeChatState`'s merge only ever sees
      // what THIS call passes as `before`.
      const freshPayloadJson = await readImportPayloadJson(clientId, importId);
      const freshChat = readChatState(freshPayloadJson);
      const nextChat = writeChatState(freshPayloadJson, {
        committedRowIds: Array.from(new Set([...freshChat.committedRowIds, ...rowIds])),
      }).chat;
      if (nextChat) setCommittedRowIds(nextChat.committedRowIds);
      await patchImportPayloadJson(clientId, importId, { chat: nextChat });
    },
    [clientId, importId, result],
  );

  // `onEditCell` — a local edit to a kept row. Nothing round-trips to the
  // server on every keystroke; the edited row rides along in `result.rows`
  // and reaches the server the next time ANY row is committed (the PATCH at
  // the top of `handleCommitRows` above sends the whole current set).
  const handleEditCell = useCallback((rowId: string, field: string, value: unknown) => {
    setResult((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        rows: prev.rows.map((row) => (row.__rowId === rowId ? { ...row, [field]: value } : row)),
      };
    });
  }, []);

  // `onRestore` — lifts an excluded (rollup-detected) row into the working
  // set WITHOUT committing it (Task 10 review, CRITICAL). The advisor still
  // has to click Commit on it afterward.
  const handleRestore = useCallback((row: Row) => {
    setResult((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        rows: [...prev.rows, row],
        excluded: prev.excluded.filter((x) => x.row.__rowId !== row.__rowId),
      };
    });
  }, []);

  // Closes the import (Ruling 61/70) — `persistPartialCommit` deliberately
  // never flips `status` on a row-filtered commit, so an import committed
  // entirely row-by-row stays "review" forever without this. The finalize
  // route re-verifies server-side; a premature click surfaces its 409 as
  // readable copy rather than a false success.
  const handleFinalize = useCallback(async () => {
    setFinalizeStatus("pending");
    setFinalizeError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/imports/${importId}/chat/finalize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        const retryAfter = res.headers.get("retry-after");
        setFinalizeStatus("error");
        setFinalizeError(
          (body.error ?? `Could not close this import (HTTP ${res.status}).`) +
            (retryAfter ? ` Retry in ${retryAfter}s.` : ""),
        );
        return;
      }
      setFinalizeStatus("done");
    } catch (err) {
      setFinalizeStatus("error");
      setFinalizeError(err instanceof Error ? err.message : "Could not reach the server.");
    }
  }, [clientId, importId]);

  return {
    result,
    committedRowIds,
    finalizeStatus,
    finalizeError,
    resetForNewExtraction,
    applyExtractionResult,
    handleCommitRows,
    handleEditCell,
    handleRestore,
    handleFinalize,
  };
}
