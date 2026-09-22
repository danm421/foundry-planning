import { useCallback, useEffect, useRef, useState } from "react";
import type { CommitRowsOptions } from "@/components/statement-chat/entity-table";
import type { ExcludedRow } from "@/components/statement-chat/excluded-rows";
import type { ExtractedAccount, ExtractedHolding, ExtractedLiability } from "@/lib/extraction/types";
import {
  isLiabilityRowId,
  type Annotated,
  type ExcludedChatRow,
  type MatchAnnotation,
} from "@/lib/imports/types";
import { readChatState, writeChatState, type ChatTurn } from "@/lib/statement-chat/state";
import { resolveOwnersFromHint, type OwnerMatchFamilyMember } from "@/lib/imports/owner-match";
import { reannotateAccountRows } from "@/lib/imports/annotate-accounts";
import type { AccountCandidate } from "@/lib/imports/match-keys/account";
import { is529Account } from "@/lib/accounts/is-529";

type Row = Annotated<ExtractedAccount>;
type LiabilityRow = Annotated<ExtractedLiability>;

export interface ChatCommitResult {
  summary: string;
  caveats: string[];
  rows: Row[];
  /**
   * MIXED as of Task 12 — `drop_row`/`merge_rows` retire debt rows into the
   * same list, and the mount hydration copies `chat.excludedRows` straight
   * in. Named at `ExcludedChatRow` so the type says so; it does NOT make the
   * union discriminable, because `ExtractedAccount` requires only `name` and
   * the two row types are assignable in BOTH directions. Anything that has
   * to know which table an entry came from narrows on the `__rowId` prefix
   * (`isLiabilityRowId`) — see `handleRestore` below and `chat-surface.tsx`'s
   * split of this same list.
   */
  excluded: ExcludedRow<ExcludedChatRow>[];
  liabilities: LiabilityRow[];
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
 * Overlays ONLY the `match` stamp from `freshRows` onto each of `localRows`
 * — never any other field (round 2 review, item 3): taking `fresh` wholesale
 * would silently discard a local field edit on a row the server shows as
 * `exact` but the caller's own state doesn't yet know is committed. Pure —
 * no fetch — so `commitRowsNow` (Task 10b) and `flushRowsToServer` (Task 11b
 * fix round 1/2, Ruling 95/100) can each read their OWN fresh snapshot (the
 * latter needs `chat.excludedRows` from the SAME read too) and share only
 * this merge step.
 *
 * Generic over any `Annotated<T>` (Task 11, Ruling 42): the hazard is
 * identical on liabilities — a fresh server read can show `match: exact`
 * from a prior commit that this surface's PATCH must not overwrite — and the
 * body only ever touches `__rowId`/`match`, so it generalizes with no
 * behaviour change rather than needing a second, liabilities-only copy.
 */
function overlayFreshMatch<T extends { __rowId?: string; match?: MatchAnnotation }>(
  freshRows: T[],
  localRows: T[],
): T[] {
  const freshByRowId = new Map(freshRows.map((r) => [r.__rowId, r] as const));
  return localRows.map((row) => {
    const fresh = row.__rowId ? freshByRowId.get(row.__rowId) : undefined;
    return fresh?.match?.kind === "exact" ? { ...row, match: fresh.match } : row;
  });
}

/**
 * Runs `fn` after `queueRef`'s current tail settles — resolved OR
 * rejected (`.then(fn, fn)`), so one failed queued call never blocks the
 * next — then re-arms the tail with a promise that swallows `fn`'s own
 * outcome the same way, so the ref always stays a bare `Promise<void>`.
 * Shared by `handleCommitRows`/`flushRowsToServer`/`adoptTurnPayload`
 * below — every writer that must serialize through `commitQueueRef` (see
 * its own comment for why) used to hand-roll this exact chain.
 */
function enqueue<T>(queueRef: { current: Promise<void> }, fn: () => T | Promise<T>): Promise<T> {
  const task = queueRef.current.then(fn, fn);
  queueRef.current = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

/**
 * Owns everything downstream of a completed extraction: the working table
 * (`result`), which rows are locked (`committedRowIds`), and closing the
 * import. Split out of `chat-surface.tsx` (Task 10b) once that file's own
 * commit/edit/restore/finalize wiring pushed it well past 300 lines —
 * `runExtraction`'s SSE plumbing stays there; this is the review-and-commit
 * half.
 */
export function useChatCommit(
  clientId: string,
  importId: string,
  family: OwnerMatchFamilyMember[] = [],
  candidates: AccountCandidate[] = [],
) {
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

  // Hydrate `committedRowIds`, `transcript` AND the rows themselves from the
  // persisted state on mount, so a reload (or resuming a chat import from the
  // drafts list) shows a row already committed in an earlier session as
  // locked instead of re-committable (brief Step 2, "survives a reload"),
  // reads the conversation's history back rather than starting blank (Task
  // 11b, C2 — ONE request, one parse, no second GET), and shows the TABLE
  // those rows belong to (final review, I2).
  //
  // The rows were always in this same response and were simply ignored, so a
  // resumed draft rendered a transcript and a composer above an empty space —
  // which the browser pass recorded as reading like "did this lose my work?".
  /**
   * Resolve the statement's printed registration line against the household
   * roster and record the answer as real ownership.
   *
   * The wizard has always done this (`review-step-accounts.tsx` seeds from
   * `matchOwnersFromHint` once the roster loads); the chat surface never did,
   * so a statement headed "MICHAEL V SHARESKY" sat there as an unmatched
   * string while the plan had a Michael Sharesky on it the whole time.
   *
   * Only a `"hint"` resolution is written — the registration line actually
   * named somebody on this roster. The other two sources are NOT recorded:
   * `"coarse"` is the extractor's own client/spouse/joint guess and `"default"`
   * is the parser's "somebody has to own it" fallback, and writing either as a
   * fact would erase the difference between a match and a shrug. Those rows
   * still SHOW resolved names — `resolveOwnerDisplay` runs the same parser at
   * render time — but they keep the "Assumed" chip, because nobody has
   * confirmed them.
   *
   * A 529 is skipped: it takes a beneficiary and a grantor, never `owners[]`.
   *
   * Returning `prev` unchanged when nothing resolved is what keeps this from
   * looping — `updateResult` hands the identical object back to `setResult`,
   * which React bails out of.
   */
  useEffect(() => {
    if (family.length === 0) return;
    updateResult((prev) => {
      if (!prev) return prev;
      let changed = false;
      const rows = prev.rows.map((row) => {
        if ((row.owners && row.owners.length > 0) || is529Account(row)) return row;
        const { owners, source } = resolveOwnersFromHint(row.ownerNameHint, row.owner, family);
        if (source !== "hint" || owners.length === 0) return row;
        changed = true;
        return { ...row, owners };
      });
      return changed ? { ...prev, rows } : prev;
    });
  }, [family, result, updateResult]);

  /**
   * Match each extracted account against the accounts already on the plan.
   *
   * The wizard gets this from a server pass (`runMatchingPass`); the chat
   * surface never had one — `chat/extract/route.ts` writes rows with no `match`
   * at all — so every account it committed was an INSERT. Re-uploading this
   * quarter's statement for a household set up months ago therefore added a
   * SECOND copy of every account, double-counting net worth and every
   * projection under it.
   *
   * Run here rather than server-side because the scoring is pure and the
   * candidate list is already in the browser: the page loads it once and hands
   * it to this surface. See `annotate-accounts.ts` for why that half was lifted
   * out of `match.ts`.
   *
   * `reannotateAccountRows` owns both hazards — it refuses to overwrite a row
   * an advisor (or a completed commit) has ruled on, and it returns the
   * IDENTICAL array when nothing moved, which is what stops this effect from
   * re-triggering itself through `result`.
   */
  useEffect(() => {
    if (candidates.length === 0) return;
    updateResult((prev) => {
      if (!prev) return prev;
      const rows = reannotateAccountRows(prev.rows, candidates, family);
      return rows === prev.rows ? prev : { ...prev, rows };
    });
  }, [candidates, family, result, updateResult]);

  // Hydrated HERE rather than handed down as a server prop (prior Ruling 91):
  // a prop would be a third source of truth that goes stale the instant a
  // turn lands.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const payloadJson = await readImportPayloadJson(clientId, importId);
        if (!cancelled) {
          const chat = readChatState(payloadJson);
          setCommittedRowIds(chat.committedRowIds);
          setTranscript(chat.transcript);

          const persisted = payloadJson as
            | { payload?: { accounts?: Row[]; liabilities?: LiabilityRow[] } }
            | undefined;
          const accounts = persisted?.payload?.accounts ?? [];
          const liabilities = persisted?.payload?.liabilities ?? [];
          // Only when there is genuinely something to show. A brand-new
          // import that has never been extracted must keep rendering nothing
          // at all, not the "No accounts or debts found in these statements"
          // empty state, which would be a claim about statements nobody has
          // read.
          //
          // `liabilities.length > 0` (Task 11) covers a mortgage-only draft
          // reopened later: zero accounts and zero excluded rows would
          // otherwise leave this gate closed forever, even though a real
          // liability is sitting in the persisted payload.
          //
          // And only when nothing has populated `result` already: this fetch
          // is async, so an advisor who clicks Extract immediately can have
          // `resetForNewExtraction` (or even the stream's own "done") land
          // first, and a late hydration must never overwrite it with the
          // pre-extraction rows. `summary: ""` skips the summary card the
          // same way `adoptTurnPayload` does (Minor 8).
          if (
            resultRef.current === null &&
            (accounts.length > 0 || chat.excludedRows.length > 0 || liabilities.length > 0)
          ) {
            updateResult(() => ({
              summary: "",
              caveats: [],
              rows: accounts,
              excluded: chat.excludedRows,
              liabilities,
            }));
          }
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
  }, [clientId, importId, updateResult]);

  /**
   * The rows as they stood when the current extraction run started.
   *
   * `resetForNewExtraction` nulls `result` BEFORE the request goes out, so by
   * the time the stream's "done" lands `applyExtractionResult`'s `prev` is
   * always null on a re-extraction and nothing can be carried forward from it.
   * Holding them here is what spans that gap. `__rowId` survives a
   * re-extraction (`rebase.ts` carries a standing row's id onto its fresh
   * counterpart), so it is still a valid key on the other side.
   */
  const preResetRowsRef = useRef<Row[]>([]);

  // Called at the start of a (re-)extraction run, so a stale table and a
  // stale finalize state from a previous run don't linger under a fresh
  // streaming pass.
  const resetForNewExtraction = useCallback(() => {
    preResetRowsRef.current = resultRef.current?.rows ?? [];
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
        // `prev` is null on every re-extraction (see `preResetRowsRef`), so
        // the pre-reset snapshot is the real source here, not a fallback.
        const priorRows = prev?.rows ?? preResetRowsRef.current;
        const priorByRowId = new Map(priorRows.map((r) => [r.__rowId, r]));
        return {
          ...ev,
          // Defensive, not redundant with the required type above: the SSE
          // frame is parsed with an UNCHECKED `JSON.parse(...) as
          // ChatExtractEvent` cast (`chat-surface.tsx`), so a `done` frame
          // that predates Task 11 (or a test fixture that never added the
          // key) hands back `undefined` at runtime regardless of what the
          // type claims — this file's own idiom for exactly that gap
          // (`?? []` on `payload.accounts` elsewhere in this file).
          liabilities: ev.liabilities ?? [],
          rows: ev.rows.map((row) => {
            const prior = row.__rowId ? priorByRowId.get(row.__rowId) : undefined;
            // A locked row carries BOTH halves of the ruling. The server never
            // emits `matchLocked` — `chat/extract/route.ts` re-emits every row
            // bare — so dropping it here hands the annotation pass a row it
            // considers re-annotatable, and an advisor's deliberate "create as
            // new" is re-derived straight back to `fuzzy`: the ruling gone and
            // the row's Commit blocked again. Checked before the `exact` clause
            // because a locked ruling may be either kind.
            if (prior?.matchLocked) {
              return { ...row, match: prior.match, matchLocked: true };
            }
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
    async (rowIds: string[], overrideAll: boolean) => {
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
        | { payload?: { accounts?: Row[]; liabilities?: LiabilityRow[] } }
        | undefined;
      const mergedAccounts = overlayFreshMatch(
        freshPayloadJsonForCommit?.payload?.accounts ?? [],
        current.rows,
      );
      const mergedLiabilities = overlayFreshMatch(
        freshPayloadJsonForCommit?.payload?.liabilities ?? [],
        current.liabilities,
      );

      await patchImportPayloadJson(clientId, importId, {
        payload: { accounts: mergedAccounts, liabilities: mergedLiabilities },
      });

      const res = await fetch(`/api/clients/${clientId}/imports/${importId}/commit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Both tabs, always. `commitLiabilities` now honours `rowIds` (Task
        // 6), so naming the second tab can no longer commit its rows
        // unfiltered — which is exactly what `commit/types.ts`'s own
        // `rowIds` doc comment warns about, and why the pre-liabilities
        // version of this comment said to send "accounts" alone. Sending
        // both in ONE request also matters: the orchestrator applies tabs in
        // canonical order (accounts before liabilities) regardless of array
        // order, which is what lets a synthesized property commit before
        // `matchMortgageToProperty` looks for it.
        //
        // `overrideRowIds` is sent only when the box is ticked — the route
        // refuses an empty array, and omitting the key is what "no override"
        // means there. It is read by `commitAccounts` ALONE, so it is inert
        // for the liabilities tab; and only the accounts table offers the
        // box, so the liabilities co-post never sets it.
        body: JSON.stringify({
          tabs: ["accounts", "liabilities"],
          rowIds,
          ...(overrideAll ? { overrideRowIds: rowIds } : {}),
        }),
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
      // carries the `linkCreated` stamp `commitAccounts`/`commitLiabilities`
      // made for the row(s) just committed, so the local view stays in step
      // with the server's.
      const body = (await res.json()) as {
        payload?: { accounts?: Row[]; liabilities?: LiabilityRow[] };
      };
      const nextRows = body.payload?.accounts;
      const nextLiabilities = body.payload?.liabilities;
      if (nextRows || nextLiabilities) {
        updateResult((prev) =>
          prev
            ? {
                ...prev,
                rows: nextRows ?? prev.rows,
                liabilities: nextLiabilities ?? prev.liabilities,
              }
            : prev,
        );
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
  // Chains every call through `commitQueueRef` (via `enqueue`) so at most
  // one is ever running `commitRowsNow` at a time — see that function's
  // docstring and the queue's own comment above for why.
  const handleCommitRows = useCallback(
    (rowIds: string[], opts?: CommitRowsOptions): Promise<void> =>
      enqueue(commitQueueRef, () => commitRowsNow(rowIds, opts?.overrideAll ?? false)),
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

  // `onEditCell` for `LiabilitiesTable` — Task 11, Ruling 37. Its `onPick`
  // calls `onEditCell(row.__rowId, "match", next)` then
  // `onEditCell(row.__rowId, "matchLocked", true)`, exactly like
  // `AccountsTable`'s. Passing the accounts `handleEditCell` above there
  // would map over `result.rows` — an array with no liability row ids in
  // it — so a picked match would silently evaporate and, combined with a
  // fuzzy liability's Commit button reading "Pick a match first", the row
  // could never be committed. Mirrors `handleEditCell` exactly, mapping over
  // `result.liabilities` instead of `result.rows`.
  const handleEditLiabilityCell = useCallback(
    (rowId: string, field: string, value: unknown) => {
      updateResult((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          liabilities: prev.liabilities.map((row) =>
            row.__rowId === rowId ? { ...row, [field]: value } : row,
          ),
        };
      });
    },
    [updateResult],
  );

  /**
   * R22: the shared body of `handleEditHolding`/`handleDropHolding` below —
   * both are "find the row, find the position within it, merge a partial
   * patch onto it" and previously differed only in the shape of that patch.
   * Kept INTERNAL (not returned from the hook): the two named handlers are
   * the public surface both `holdings-table.tsx` and its tests call, and
   * Task 7's server-side handler needs the same merge, not this hook's own
   * `updateResult` plumbing.
   *
   * Patch one position, addressed by its account AND its own id — a
   * `__holdingId` is unique only within its account (Task 2).
   */
  const patchHolding = useCallback(
    (rowId: string, holdingId: string, patch: Partial<ExtractedHolding>) => {
      updateResult((prev) =>
        prev && {
          ...prev,
          rows: prev.rows.map((row) =>
            row.__rowId !== rowId
              ? row
              : {
                  ...row,
                  holdings: (row.holdings ?? []).map((h) =>
                    h.__holdingId === holdingId ? { ...h, ...patch } : h,
                  ),
                },
          ),
        },
      );
    },
    [updateResult],
  );

  const handleEditHolding = useCallback(
    (rowId: string, holdingId: string, field: string, value: unknown) => {
      patchHolding(rowId, holdingId, { [field]: value } as Partial<ExtractedHolding>);
    },
    [patchHolding],
  );

  /** Tombstone, never a splice: the position is still in `fileResults` and a
   *  re-extraction would put a removed one straight back. */
  const handleDropHolding = useCallback(
    (rowId: string, holdingId: string) => {
      patchHolding(rowId, holdingId, { __dropped: true });
    },
    [patchHolding],
  );

  // `onRestore` — lifts an excluded (rollup-detected) row into the working
  // set WITHOUT committing it (Task 10 review, CRITICAL). The advisor still
  // has to click Commit on it afterward.
  //
  // Task 12b, Finding 1 (CRITICAL): routed by TABLE. Task 12 let `drop_row`
  // retire a LIABILITY into the same `excludedRows` list, and this pushed
  // every restored row into `prev.rows` with no check at all — so one click
  // on "Include anyway" filed a dropped debt as an ASSET, inverting the sign
  // of a number on the balance sheet. That is verbatim the defect
  // `dropDebtsFiledAsAssets` exists to undo.
  //
  // The discriminator is `isLiabilityRowId` — the `__rowId` PREFIX, shared
  // with `chat-surface.tsx`'s split of the same list so the two can never
  // disagree about which card a row belongs to. It cannot be a field check
  // and the compiler cannot help: `ExtractedAccount` requires only `name`,
  // so an account row and a debt row are assignable in BOTH directions.
  //
  // Idempotent by `__rowId` (Ruling 100, Task 11b fix round 2, clause 2): a
  // row already in the working set is never appended twice, whatever the
  // excluded list says. The row can legitimately reappear in `excluded` a
  // SECOND time — this surface's own flush now removes it from the
  // server's `chat.excludedRows` (below), but a resumed draft, a slow
  // flush, or a genuinely fresh re-detection could still hand it back —
  // and without this guard a second "Include anyway" click on the SAME row
  // would insert a second copy that later commits as a duplicate account.
  const handleRestore = useCallback(
    (row: ExcludedChatRow) => {
      updateResult((prev) => {
        if (!prev) return prev;
        const excluded = prev.excluded.filter((x) => x.row.__rowId !== row.__rowId);
        if (isLiabilityRowId(row.__rowId)) {
          const alreadyWorking =
            row.__rowId != null && prev.liabilities.some((r) => r.__rowId === row.__rowId);
          return {
            ...prev,
            liabilities: alreadyWorking ? prev.liabilities : [...prev.liabilities, row],
            excluded,
          };
        }
        const alreadyWorking =
          row.__rowId != null && prev.rows.some((r) => r.__rowId === row.__rowId);
        return {
          ...prev,
          rows: alreadyWorking ? prev.rows : [...prev.rows, row],
          excluded,
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
      const freshPersisted = freshPayloadJson as
        | { payload?: { accounts?: Row[]; liabilities?: LiabilityRow[] } }
        | undefined;
      const mergedAccounts = overlayFreshMatch(
        freshPersisted?.payload?.accounts ?? [],
        current.rows,
      );
      const mergedLiabilities = overlayFreshMatch(
        freshPersisted?.payload?.liabilities ?? [],
        current.liabilities,
      );

      const freshChat = readChatState(freshPayloadJson);
      // BOTH tables (Task 12b, Finding 2 — leg 6 of the loop). Built from
      // `current.rows` alone, a liability exclusion never cleared
      // server-side: the turn route kept echoing it back while
      // `mergedLiabilities` above kept writing the row into the table, so a
      // dropped debt sat in the table AND in "Not included" for the life of
      // the import. An account id and a liability id can never collide —
      // they carry different section prefixes — so one set covers both.
      const restoredIds = new Set(
        [...current.rows, ...current.liabilities]
          .map((r) => r.__rowId)
          .filter((id): id is string => Boolean(id)),
      );
      const nextExcludedRows = freshChat.excludedRows.filter(
        (x) => !(x.row.__rowId && restoredIds.has(x.row.__rowId)),
      );

      await patchImportPayloadJson(clientId, importId, {
        payload: { accounts: mergedAccounts, liabilities: mergedLiabilities },
        chat: writeChatState(freshPayloadJson, { excludedRows: nextExcludedRows }).chat,
      });
    };
    return enqueue(commitQueueRef, apply);
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
  // `liabilities` (Ruling 51/54, Task 12b) replaces wholesale for exactly the
  // same reason, and Ruling 95's argument for the accounts replace transfers
  // unchanged: `flushRowsToServer` runs before every turn, so the server
  // genuinely holds everything the advisor sees by the time the route reads
  // it. Its preconditions hold identically here — the flush writes
  // `payload.liabilities` in the same PATCH, and `chat-surface.tsx` disables
  // every commit affordance for the whole `turnStatus === "sending"` window.
  //
  // But `undefined` PRESERVES rather than clearing. Ruling 39 set `?? []` at
  // the SSE boundary, where absence really does mean "no liabilities"; here
  // absence can also mean an OLDER route answered a NEWER client mid-deploy,
  // and `?? []` would wipe the advisor's reviewed debts off the screen. An
  // empty ARRAY still clears — that is the route saying there are none left,
  // e.g. the advisor just dropped the last debt. One check, correct in both
  // directions.
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
    (
      accounts: Row[],
      excluded: ExcludedRow<ExcludedChatRow>[],
      liabilities: LiabilityRow[] | undefined,
    ): Promise<void> =>
      enqueue(commitQueueRef, () => {
        updateResult((prev) =>
          prev
            ? { ...prev, rows: accounts, excluded, liabilities: liabilities ?? prev.liabilities }
            : {
                summary: "",
                caveats: [],
                rows: accounts,
                excluded,
                liabilities: liabilities ?? [],
              },
        );
      }),
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
    handleEditLiabilityCell,
    handleEditHolding,
    handleDropHolding,
    handleRestore,
    handleFinalize,
  };
}
