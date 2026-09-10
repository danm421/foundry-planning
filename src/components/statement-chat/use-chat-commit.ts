import { useCallback, useEffect, useRef, useState } from "react";
import type { ExcludedRow } from "@/components/statement-chat/excluded-rows";
import type { ExtractedAccount } from "@/lib/extraction/types";
import type { Annotated } from "@/lib/imports/types";
import { readChatState, writeChatState, type ChatTurn } from "@/lib/statement-chat/state";

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
 * Overlays ONLY the `match` stamp from `freshAccounts` onto each of
 * `localRows` — never any other field (round 2 review, item 3): taking
 * `fresh` wholesale would silently discard a local field edit on a row the
 * server shows as `exact` but the caller's own state doesn't yet know is
 * committed. Pure — no fetch — so `commitRowsNow` (Task 10b) and
 * `flushRowsToServer` (Task 11b fix round 1/2, Ruling 95/100) can each read
 * their OWN fresh snapshot (the latter needs `chat.excludedRows` from the
 * SAME read too) and share only this merge step.
 */
function overlayFreshMatch(freshAccounts: Row[], localRows: Row[]): Row[] {
  const freshByRowId = new Map(freshAccounts.map((r) => [r.__rowId, r] as const));
  return localRows.map((row) => {
    const fresh = row.__rowId ? freshByRowId.get(row.__rowId) : undefined;
    return fresh?.match?.kind === "exact" ? { ...row, match: fresh.match } : row;
  });
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
  // The persisted conversation (Task 11b, C2) — hydrated by the SAME mount
  // GET as `committedRowIds` below, not a second request: `.transcript` sits
  // on the identical `payloadJson` this effect already fetches and parses.
  const [transcript, setTranscript] = useState<ChatTurn[]>([]);
  const [finalizeStatus, setFinalizeStatus] = useState<FinalizeStatus>("idle");
  const [finalizeError, setFinalizeError] = useState<string | null>(null);

  // Mirrors `result` synchronously (unlike a `useEffect`-driven mirror,
  // which only catches up after the next render/commit). `handleCommitRows`
  // below is SERIALIZED through `commitQueueRef`, and a queued commit can
  // run long after the click that enqueued it — it must read the row set
  // as it stands the moment it actually runs, not the one captured in the
  // closure at click time, or a fast second click would build its PATCH
  // from data that predates the first commit's own adoption step (round 1
  // review, Important 1 — the "two quick clicks on different rows" case).
  const resultRef = useRef<ChatCommitResult | null>(null);
  const updateResult = useCallback(
    (updater: (prev: ChatCommitResult | null) => ChatCommitResult | null) => {
      const next = updater(resultRef.current);
      resultRef.current = next;
      setResult(next);
    },
    [],
  );

  // Serializes every `handleCommitRows` call so at most one is ever
  // mid-flight (round 1 review, Important 1). Without this, two commits for
  // DIFFERENT rows, fired close together, can interleave their own
  // read → PATCH → commit → persist sequences: each reads `payload.accounts`
  // before the other's write lands, so whichever's PATCH lands second
  // silently regresses the first row's freshly-stamped `{kind: "exact"}`
  // back to `{kind: "new"}` — the exact hole `linkCreated` exists to close,
  // reopened by a race rather than a stale snapshot. Chaining through one
  // promise makes row 2's read happen only after row 1's write has fully
  // landed, whatever order the clicks arrived in.
  const commitQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Hydrate `committedRowIds` AND `transcript` from the persisted chat state
  // on mount, so a reload (or resuming a chat import from the drafts list)
  // shows a row already committed in an earlier session as locked instead of
  // re-committable (brief Step 2, "survives a reload"), and reads the
  // conversation's history back rather than starting blank (Task 11b, C2 —
  // ONE request, one parse, both fields; no second GET).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const payloadJson = await readImportPayloadJson(clientId, importId);
        if (!cancelled) {
          const chat = readChatState(payloadJson);
          setCommittedRowIds(chat.committedRowIds);
          setTranscript(chat.transcript);
        }
      } catch (err) {
        // Best-effort hydration: a failed read just means rows show as
        // not-yet-committed (until the first successful commit repopulates
        // that list) and the transcript starts empty — not a mutation, so
        // nothing to surface as an error.
        console.error("Could not load this import's chat state:", err);
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
    updateResult(() => null);
    setFinalizeStatus("idle");
    setFinalizeError(null);
  }, [updateResult]);

  // Called when the extraction stream's "done" event lands.
  //
  // Re-extraction (appending a new file) re-merges EVERY row fresh from
  // `fileResults`, which carries no memory of an earlier commit —
  // `mergeAcrossFiles` always emits `match: {kind: "new"}` (Task 1-6). This
  // carries forward `match: "exact"` for any `__rowId` this hook's OWN
  // in-memory state already knows was linked — a same-session convenience,
  // kept as a defensive second layer, but NOT what actually guarantees
  // correctness: `commitRowsNow` below re-derives the same fact from the
  // SERVER on every commit, which is what covers a resume this in-memory
  // carry-forward cannot (there is no `prev` after a reload).
  const applyExtractionResult = useCallback(
    (ev: ChatCommitResult) => {
      updateResult((prev) => {
        const priorByRowId = new Map((prev?.rows ?? []).map((r) => [r.__rowId, r]));
        return {
          ...ev,
          rows: ev.rows.map((row) => {
            const prior = row.__rowId ? priorByRowId.get(row.__rowId) : undefined;
            return prior?.match?.kind === "exact" ? { ...row, match: prior.match } : row;
          }),
        };
      });
    },
    [updateResult],
  );

  // The actual commit body, run ONLY from inside `commitQueueRef`'s chain
  // (see `handleCommitRows` below) — never call this directly.
  //
  // `payloadJson.payload.accounts` has to exist at all before the shared
  // commit route will do anything (`chat/extract/route.ts` only ever
  // streams `kept` to the client; it never persists it as `payload` —
  // that's the wizard's `/match` step, which this surface doesn't run), and
  // it has to be the CURRENT view of every row.
  //
  // "Current" is NOT simply `resultRef.current` (round 1 review, Important
  // 1): after a reload, this hook's in-memory state has no idea which rows
  // were already committed in an earlier session, and `mergeAcrossFiles`
  // re-emits every row as `{kind: "new"}` regardless. So this reads
  // `payload.accounts` fresh from the server FIRST, and for every row that
  // read shows as already `{kind: "exact"}`, uses THAT entry verbatim
  // rather than the local one — the server's record of a link, once made,
  // is never something this surface's own PATCH is allowed to overwrite.
  // Because every commit is serialized through the same queue, this fresh
  // read is also never racing an earlier commit's own write: whatever the
  // previous queued commit persisted has already landed by the time this
  // read happens.
  const commitRowsNow = useCallback(
    async (rowIds: string[]) => {
      const current = resultRef.current;
      if (!current) return;

      // Only `match` needs to come from the server — `linkCreated`
      // (`lib/imports/types.ts:209`) sets nothing else on the row. Taking
      // `fresh` wholesale (round 2 review, item 3) would silently discard a
      // local field edit on a row the server shows as `exact` but this
      // hook's own `committedRowIds` doesn't yet know about (reachable when
      // the bookkeeping chat PATCH failed after a prior commit — an
      // editable-until-locked row, since `committedRowIds`, not `match`, is
      // what disables editing in `entity-table.tsx`).
      const freshPayloadJsonForCommit = (await readImportPayloadJson(clientId, importId)) as
        | { payload?: { accounts?: Row[] } }
        | undefined;
      const mergedAccounts = overlayFreshMatch(
        freshPayloadJsonForCommit?.payload?.accounts ?? [],
        current.rows,
      );

      await patchImportPayloadJson(clientId, importId, {
        payload: { accounts: mergedAccounts },
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
      // just committed, so the local view stays in step with the server's.
      const body = (await res.json()) as { payload?: { accounts?: Row[] } };
      const nextRows = body.payload?.accounts;
      if (nextRows) {
        updateResult((prev) => (prev ? { ...prev, rows: nextRows } : prev));
      }

      // Lock the row in the UI regardless of whether the bookkeeping write
      // below succeeds — the account itself is already committed.
      setCommittedRowIds((prev) => Array.from(new Set([...prev, ...rowIds])));

      // Persist the lock so it survives a reload (brief Step 2). Read fresh
      // immediately before writing (Ruling 63): a re-extraction could have
      // changed `chat.decisions` / `excludedRows` server-side since this
      // hook last read them, and `writeChatState`'s merge only ever sees
      // what THIS call passes as `before`.
      const freshChatPayloadJson = await readImportPayloadJson(clientId, importId);
      const freshChat = readChatState(freshChatPayloadJson);
      const nextChat = writeChatState(freshChatPayloadJson, {
        committedRowIds: Array.from(new Set([...freshChat.committedRowIds, ...rowIds])),
      }).chat;
      if (nextChat) setCommittedRowIds(nextChat.committedRowIds);
      await patchImportPayloadJson(clientId, importId, { chat: nextChat });
    },
    [clientId, importId, updateResult],
  );

  // `onCommitRows` (AccountsTable → EntityTable's per-row Commit button).
  // Chains every call through `commitQueueRef` so at most one is ever
  // running `commitRowsNow` at a time — see that function's docstring and
  // the queue's own comment above for why. `.then(fn, fn)` (not
  // `.then(fn).catch(fn)`) so an earlier commit's REJECTION doesn't skip
  // this one; the queue only sequences, it never lets one row's failure
  // block another's.
  const handleCommitRows = useCallback(
    (rowIds: string[]): Promise<void> => {
      const task = commitQueueRef.current.then(
        () => commitRowsNow(rowIds),
        () => commitRowsNow(rowIds),
      );
      commitQueueRef.current = task.then(
        () => undefined,
        () => undefined,
      );
      return task;
    },
    [commitRowsNow],
  );

  // `onEditCell` — a local edit to a kept row. Nothing round-trips to the
  // server on every keystroke; the edited row rides along in `result.rows`
  // and reaches the server the next time ANY row is committed (the PATCH at
  // the top of `handleCommitRows` above sends the whole current set).
  const handleEditCell = useCallback(
    (rowId: string, field: string, value: unknown) => {
      updateResult((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          rows: prev.rows.map((row) => (row.__rowId === rowId ? { ...row, [field]: value } : row)),
        };
      });
    },
    [updateResult],
  );

  // `onRestore` — lifts an excluded (rollup-detected) row into the working
  // set WITHOUT committing it (Task 10 review, CRITICAL). The advisor still
  // has to click Commit on it afterward.
  // Idempotent by `__rowId` (Ruling 100, Task 11b fix round 2, clause 2): a
  // row already in the working set is never appended twice, whatever the
  // excluded list says. The row can legitimately reappear in `excluded` a
  // SECOND time — this surface's own flush now removes it from the
  // server's `chat.excludedRows` (below), but a resumed draft, a slow
  // flush, or a genuinely fresh re-detection could still hand it back —
  // and without this guard a second "Include anyway" click on the SAME row
  // would insert a second copy that later commits as a duplicate account.
  const handleRestore = useCallback(
    (row: Row) => {
      updateResult((prev) => {
        if (!prev) return prev;
        const alreadyWorking =
          row.__rowId != null && prev.rows.some((r) => r.__rowId === row.__rowId);
        return {
          ...prev,
          rows: alreadyWorking ? prev.rows : [...prev.rows, row],
          excluded: prev.excluded.filter((x) => x.row.__rowId !== row.__rowId),
        };
      });
    },
    [updateResult],
  );

  // Appends a turn's own transcript delta (Task 11b, C1) — ALWAYS the array
  // the turn route returned (`turnEntries`), never a locally composed
  // user/assistant string, so the in-session transcript never disagrees with
  // the one that reads back after a reload. Not routed through
  // `commitQueueRef`: unlike `adoptTurnPayload` below, the transcript is
  // display-only and never read back by a commit's PATCH, so it has nothing
  // to race.
  const appendTurnEntries = useCallback((entries: ChatTurn[]) => {
    setTranscript((prev) => [...prev, ...entries]);
  }, []);

  // Pushes the surface's CURRENT local row state to the server BEFORE a turn
  // is sent (Task 11b, Ruling 95/100 — replaces the review's Critical 1
  // fix, twice: round 1 covered only rows, round 2 closes the residual).
  // Local edits (`handleEditCell`) and a restored row (`handleRestore`)
  // never round-trip to the server on their own — nothing but a commit used
  // to send them. Without this, the model would answer a question from
  // STALE server rows the advisor had already corrected on-screen, and
  // `adoptTurnPayload`'s wholesale replace (below) would then silently
  // revert those same local edits the moment the response landed.
  //
  // Restoring a row is a TWO-PART state change (Ruling 100): the row goes
  // INTO `payload.accounts` and must come OUT of `chat.excludedRows`, or
  // the turn route echoes the still-accumulated exclusion list back
  // (`chat/turn/route.ts`'s `nextExcludedRows`), `adoptTurnPayload` puts the
  // row back into "Not included" WHILE it also sits in the table, and a
  // second "Include anyway" click (now live again) appends a duplicate
  // `__rowId` that a later commit inserts twice. So this flush writes BOTH
  // keys in ONE read + ONE PATCH:
  //   - `payload.accounts`: `current.rows` overlaid with the server's fresh
  //     `match` stamps (same merge `commitRowsNow` does).
  //   - `chat.excludedRows`: the FRESH server list, filtered to drop any
  //     entry whose row is now in `current.rows` — a MERGE against the
  //     fresh read (not a blind replace of the whole list), so a NEW
  //     exclusion another session or an earlier turn added since this
  //     surface last read it survives; only rows THIS surface has locally
  //     restored are dropped.
  //
  // Routed through the SAME `commitQueueRef` `handleCommitRows` uses — no
  // second ordering mechanism. `chat-surface.tsx` also disables per-row
  // Commit and Finish import for the whole `turnStatus === "sending"`
  // window (Finding 4), so nothing can enqueue onto this queue BETWEEN the
  // flush landing and the turn's response coming back.
  //
  // No-op when `result` is still null: nothing has been extracted or
  // adopted THIS session, so there is nothing local this hook knows that the
  // server doesn't (Step 0 already seeded it at extraction time).
  const flushRowsToServer = useCallback((): Promise<void> => {
    const apply = async () => {
      const current = resultRef.current;
      if (!current) return;

      const freshPayloadJson = await readImportPayloadJson(clientId, importId);
      const freshAccounts =
        (freshPayloadJson as { payload?: { accounts?: Row[] } } | undefined)?.payload?.accounts ?? [];
      const mergedAccounts = overlayFreshMatch(freshAccounts, current.rows);

      const freshChat = readChatState(freshPayloadJson);
      const restoredIds = new Set(
        current.rows.map((r) => r.__rowId).filter((id): id is string => Boolean(id)),
      );
      const nextExcludedRows = freshChat.excludedRows.filter(
        (x) => !(x.row.__rowId && restoredIds.has(x.row.__rowId)),
      );

      await patchImportPayloadJson(clientId, importId, {
        payload: { accounts: mergedAccounts },
        chat: writeChatState(freshPayloadJson, { excludedRows: nextExcludedRows }).chat,
      });
    };
    const task = commitQueueRef.current.then(apply, apply);
    commitQueueRef.current = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }, [clientId, importId]);

  // Adopts a turn's returned row state (Task 11b, Step 2). Now that
  // `flushRowsToServer` above runs before every turn, the server genuinely
  // holds everything the advisor sees by the time the turn route reads
  // `payload.accounts` — so this wholesale replace is CORRECT, not merely
  // safe (Ruling 95). Routed through the SAME `commitQueueRef` a commit
  // uses, so a commit that was already queued finishes and lands before
  // this adoption runs.
  //
  // Always a FULL replace of `rows`/`excluded`, never a merge: the turn
  // route's `payload.accounts` and `excludedRows` are themselves the
  // server's complete, authoritative sets (Step 0 + the flush above + the
  // route's own fresh-read merge), not deltas.
  //
  // When `prev` is null — a resumed draft with no extraction run THIS
  // session (C3) — this is the first thing to populate `result` at all, so
  // the extracted-state panel (table, Finish import) appears for the first
  // time. `summary` stays `""` here (Minor 8) rather than the turn's own
  // reply text: that text already renders in the transcript, and putting it
  // in the extraction-summary slot too would leave the FIRST turn's reply
  // stuck there permanently (every later call takes the `prev` branch, which
  // preserves whatever `summary` was set here once).
  const adoptTurnPayload = useCallback(
    (accounts: Row[], excluded: ExcludedRow<Row>[]): Promise<void> => {
      const apply = () => {
        updateResult((prev) =>
          prev ? { ...prev, rows: accounts, excluded } : { summary: "", caveats: [], rows: accounts, excluded },
        );
      };
      const task = commitQueueRef.current.then(apply, apply);
      commitQueueRef.current = task.then(
        () => undefined,
        () => undefined,
      );
      return task;
    },
    [updateResult],
  );

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
    transcript,
    finalizeStatus,
    finalizeError,
    resetForNewExtraction,
    applyExtractionResult,
    appendTurnEntries,
    flushRowsToServer,
    adoptTurnPayload,
    handleCommitRows,
    handleEditCell,
    handleRestore,
    handleFinalize,
  };
}
