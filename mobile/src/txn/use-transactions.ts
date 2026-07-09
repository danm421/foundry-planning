// mobile/src/txn/use-transactions.ts
//
// Transactions list state: a pure reducer (unit-tested directly, no fetch
// inside) plus a useTransactions hook that owns paging + optimistic
// mutations on top of it. The screen stays thin — it only assembles the
// filter query and renders `rows`.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PortalTransactionDTO, TransactionsPageDTO } from "@contracts";
import type { ApiClient } from "@/api/client";
import type { TxnQuery } from "@/api/query";
import {
  fetchTransactions,
  markAllReviewed,
  markReviewed,
  recategorize,
  setExcluded as apiSetExcluded,
} from "@/api/portal";

export const TXN_PAGE_SIZE = 50;

export interface TxnState {
  rows: PortalTransactionDTO[];
  total: number;
  hasMore: boolean;
}

export const initialTxnState: TxnState = { rows: [], total: 0, hasMore: false };

export type TxnAction =
  | { type: "appendPage"; page: TransactionsPageDTO }
  | { type: "reset" }
  | { type: "setReviewed"; id: string; reviewed: boolean }
  | { type: "setCategory"; id: string; categoryId: string | null; categoryName: string | null; categoryColor: string | null }
  | { type: "setExcluded"; id: string; excluded: boolean }
  | { type: "markAll" };

function updateRow(
  state: TxnState,
  id: string,
  fn: (row: PortalTransactionDTO) => PortalTransactionDTO,
): TxnState {
  return { ...state, rows: state.rows.map((r) => (r.id === id ? fn(r) : r)) };
}

/** Pure — no fetch here, so this is the part covered directly by
 *  use-transactions.test.ts. */
export function txnReducer(state: TxnState, action: TxnAction): TxnState {
  switch (action.type) {
    case "appendPage":
      return {
        rows: [...state.rows, ...action.page.transactions],
        total: action.page.total,
        hasMore: action.page.hasMore,
      };
    case "reset":
      return initialTxnState;
    case "setReviewed":
      return updateRow(state, action.id, (r) => ({ ...r, reviewed: action.reviewed }));
    case "setCategory":
      return updateRow(state, action.id, (r) => ({
        ...r,
        categoryId: action.categoryId,
        categoryName: action.categoryName,
        categoryColor: action.categoryColor,
      }));
    case "setExcluded":
      return updateRow(state, action.id, (r) => ({ ...r, excluded: action.excluded }));
    case "markAll":
      // Mirrors the server's review-all WHERE (portal/transactions/review-all/route.ts):
      // non-excluded, non-transfer, unreviewed rows only.
      return {
        ...state,
        rows: state.rows.map((r) =>
          !r.excluded && r.type !== "transfer" ? { ...r, reviewed: true } : r,
        ),
      };
    default:
      return state;
  }
}

export type TxnFilter = Omit<TxnQuery, "limit" | "offset">;
export type CategoryPick = { id: string; name: string; color: string } | null;

export interface UseTransactionsResult {
  rows: PortalTransactionDTO[];
  total: number;
  hasMore: boolean;
  /** True while the initial page (or a reset-triggered reload) is in flight. */
  loading: boolean;
  /** True while an additional page (loadMore) is in flight. */
  loadingMore: boolean;
  /** The initial/reset fetch failed. */
  error: boolean;
  /** The most recent optimistic mutation failed and was rolled back. */
  mutationError: boolean;
  /** Re-fetches page 0 from scratch — call on filter change or pull-to-refresh. */
  reset: () => Promise<void>;
  loadMore: () => void;
  review: (id: string, reviewed: boolean) => void;
  changeCategory: (id: string, cat: CategoryPick) => void;
  exclude: (id: string, excluded: boolean) => void;
  markAll: () => void;
}

/** Reducer-backed transactions list: owns offset paging against
 *  fetchTransactions and exposes optimistic mutators that dispatch
 *  immediately, call the API, and roll back + flag `mutationError` on
 *  failure. `filter` changes (by value, via JSON.stringify) trigger an
 *  automatic reset+refetch; `reset()` is also exposed directly for
 *  pull-to-refresh. */
export function useTransactions(api: ApiClient, filter: TxnFilter): UseTransactionsResult {
  const [state, setState] = useState<TxnState>(initialTxnState);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [mutationError, setMutationError] = useState(false);

  // Mirrors `state` for stable-identity callbacks (optimistic mutators) that
  // need the latest rows without depending on — and re-creating on — every
  // state change.
  const stateRef = useRef(state);
  stateRef.current = state;

  const offsetRef = useRef(0);
  // Bumped by every reset() (initial load, filter change, and pull-to-refresh
  // all funnel through reset()) so an in-flight loadMore/reset fetch can tell,
  // once it resolves, whether it's still fetching for the CURRENT list. A
  // mismatch means the list was reset out from under it — its page must be
  // dropped rather than appended, otherwise rows fetched under the old filter
  // land in the new filter's list and desync offsetRef from rows.length.
  const epochRef = useRef(0);
  const dispatch = useCallback((action: TxnAction) => setState((s) => txnReducer(s, action)), []);

  const filterKey = JSON.stringify(filter);
  // filterKey is a derived, stable-per-value stand-in for `filter` itself
  // (a fresh object literal every render would otherwise refire this effect
  // on every render).
  const stableFilter = useMemo(() => filter, [filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = useCallback(async () => {
    // New epoch before anything else — any loadMore/reset fetch already in
    // flight is now stale and must drop its result on arrival.
    epochRef.current += 1;
    const epoch = epochRef.current;
    setLoading(true);
    setError(false);
    setMutationError(false);
    dispatch({ type: "reset" });
    offsetRef.current = 0;
    try {
      const page = await fetchTransactions(api, { ...stableFilter, limit: TXN_PAGE_SIZE, offset: 0 });
      if (epoch !== epochRef.current) return; // superseded by a later reset — drop it
      dispatch({ type: "appendPage", page });
      offsetRef.current = page.transactions.length;
    } catch {
      if (epoch === epochRef.current) setError(true);
    } finally {
      // Only the still-current epoch clears `loading` — an older, superseded
      // reset finishing late must not flip the flag off while a newer one is
      // still in flight (the newer call's own finally will clear it).
      if (epoch === epochRef.current) setLoading(false);
    }
  }, [api, stableFilter, dispatch]);

  useEffect(() => {
    void reset();
    // Intentionally keyed on `reset` (which itself is keyed on stableFilter,
    // not the raw filter object) so this only re-fires on real filter changes.
  }, [reset]);

  const loadMore = useCallback(() => {
    if (!stateRef.current.hasMore || loadingMore) return;
    const offset = offsetRef.current;
    const epoch = epochRef.current;
    setLoadingMore(true);
    fetchTransactions(api, { ...stableFilter, limit: TXN_PAGE_SIZE, offset })
      .then((page) => {
        if (epoch !== epochRef.current) return; // list was reset while this page was in flight
        dispatch({ type: "appendPage", page });
        offsetRef.current = offset + page.transactions.length;
      })
      .catch(() => {
        if (epoch === epochRef.current) setError(true);
      })
      // Unconditional, unlike reset()'s finally: once a reset happens,
      // loadingMore has no other writer, so a stale drop must still clear it
      // here or the reentrancy guard above wedges every future loadMore().
      .finally(() => setLoadingMore(false));
  }, [api, stableFilter, dispatch, loadingMore]);

  const review = useCallback(
    (id: string, reviewed: boolean) => {
      dispatch({ type: "setReviewed", id, reviewed });
      setMutationError(false);
      markReviewed(api, id, reviewed).catch(() => {
        dispatch({ type: "setReviewed", id, reviewed: !reviewed });
        setMutationError(true);
      });
    },
    [api, dispatch],
  );

  const changeCategory = useCallback(
    (id: string, cat: CategoryPick) => {
      const previous = stateRef.current.rows.find((r) => r.id === id);
      dispatch({
        type: "setCategory",
        id,
        categoryId: cat?.id ?? null,
        categoryName: cat?.name ?? null,
        categoryColor: cat?.color ?? null,
      });
      setMutationError(false);
      recategorize(api, id, cat?.id ?? null).catch(() => {
        dispatch({
          type: "setCategory",
          id,
          categoryId: previous?.categoryId ?? null,
          categoryName: previous?.categoryName ?? null,
          categoryColor: previous?.categoryColor ?? null,
        });
        setMutationError(true);
      });
    },
    [api, dispatch],
  );

  const exclude = useCallback(
    (id: string, excluded: boolean) => {
      dispatch({ type: "setExcluded", id, excluded });
      setMutationError(false);
      apiSetExcluded(api, id, excluded).catch(() => {
        dispatch({ type: "setExcluded", id, excluded: !excluded });
        setMutationError(true);
      });
    },
    [api, dispatch],
  );

  const markAll = useCallback(() => {
    // Capture exact prior per-row `reviewed` so a failed markAll rolls back
    // precisely (rows already reviewed before markAll must stay reviewed).
    const prior = stateRef.current.rows.map((r) => ({ id: r.id, reviewed: r.reviewed }));
    dispatch({ type: "markAll" });
    setMutationError(false);
    markAllReviewed(api).catch(() => {
      for (const r of prior) dispatch({ type: "setReviewed", id: r.id, reviewed: r.reviewed });
      setMutationError(true);
    });
  }, [api, dispatch]);

  return {
    rows: state.rows,
    total: state.total,
    hasMore: state.hasMore,
    loading,
    loadingMore,
    error,
    mutationError,
    reset,
    loadMore,
    review,
    changeCategory,
    exclude,
    markAll,
  };
}
