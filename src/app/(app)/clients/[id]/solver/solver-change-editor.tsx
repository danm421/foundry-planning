"use client";

// Opens one scenario change's Details-page editor inside the Solver's Changes
// tab. Loads the page's view props through the `loadChangeEditorProps` server
// action, then mounts that Details view in focus mode — which renders only the
// row's own dialog, as a fixed overlay. Mounted fresh for every click (the
// Changes tab keys it), so each instance loads exactly one target.
//
// Outcomes the view reports through `onFocusClose`:
// - no argument → the editor closed (cancel, save, delete…) → `onDone()`
//   unmounts everything. The view's own save already refreshed the route, and
//   the Solver re-derives from the fresh scenario tree.
// - "unavailable" → the Details page itself wouldn't open this row here
//   (Ruling T4-unavailable) → unmount the view, show a link to that page.
//
// The views are loaded with next/dynamic so five large Details views stay out
// of the Solver's initial bundle.

import { startTransition, useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { ChangeEditorTarget, EditorFocus } from "@/lib/scenario/change-editor-target";
import type { TargetKind } from "@/engine/scenario/types";
import type { AssumptionsTabId } from "@/app/(app)/clients/[id]/details/assumptions/tabs";
import { loadChangeEditorProps, type ChangeEditorViewProps } from "./change-editor-actions";

const LoadingLine = () => <HostStrip role="status">Opening the editor…</HostStrip>;

const IncomeExpensesView = dynamic(() => import("@/components/income-expenses-view"), {
  loading: LoadingLine,
});
const BalanceSheetView = dynamic(() => import("@/components/balance-sheet-view"), {
  loading: LoadingLine,
});
const TechniquesView = dynamic(() => import("@/components/techniques-view"), {
  loading: LoadingLine,
});
const FamilyView = dynamic(() => import("@/components/family-view"), { loading: LoadingLine });
const WillsPanel = dynamic(() => import("@/components/wills-panel"), { loading: LoadingLine });

// Shared by the "Try again" button and the fallback Details-page link below —
// both are a `HostStrip`'s one inline action.
const HOST_STRIP_ACTION_CLASS =
  "font-medium text-ink hover:text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded";

/** A change the resolver sends to a Details page. */
export type DetailsEditorTarget = Extract<ChangeEditorTarget, { surface: "details" }>;

interface Props {
  clientId: string;
  scenarioId: string;
  target: DetailsEditorTarget;
  /** The editor closed normally, or the advisor dismissed a message. */
  onDone: () => void;
}

type HostState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "open"; loaded: ChangeEditorViewProps }
  | { status: "unavailable"; href: string };

// Assumptions: every focus is unavailable (Ruling T4e-assumptions), so the host
// links straight to the page's matching tab instead of loading it.
const ASSUMPTIONS_TAB_BY_KIND: Partial<Record<TargetKind, AssumptionsTabId>> = {
  client_deduction: "deductions",
  client_tax_adjustment: "tax-adjustments",
  withdrawal_strategy: "withdrawal",
};

export function SolverChangeEditor({ clientId, scenarioId, target, onDone }: Props) {
  const { page, focus } = target;
  const [state, setState] = useState<HostState>(() =>
    page === "assumptions"
      ? { status: "unavailable", href: detailsHref(clientId, scenarioId, target) }
      : { status: "loading" },
  );
  // Bumped by "Try again" to re-run the load.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (page === "assumptions") return;
    let cancelled = false;
    startTransition(async () => {
      try {
        const loaded = await loadChangeEditorProps(clientId, scenarioId, page);
        if (!cancelled) setState({ status: "open", loaded });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [clientId, scenarioId, page, attempt]);

  function onFocusClose(outcome?: "unavailable") {
    if (outcome !== "unavailable") {
      onDone();
      return;
    }
    const lifeInsurance =
      state.status === "open" &&
      state.loaded.page === "net-worth" &&
      state.loaded.props.accounts.some((a) => a.id === focus.id && a.category === "life_insurance");
    setState({ status: "unavailable", href: detailsHref(clientId, scenarioId, target, lifeInsurance) });
  }

  switch (state.status) {
    case "loading":
      return <LoadingLine />;
    case "error":
      return (
        <HostStrip role="alert" onDismiss={onDone}>
          <span className="text-crit">Couldn&apos;t open this editor.</span>
          <button
            type="button"
            onClick={() => {
              setState({ status: "loading" });
              setAttempt((n) => n + 1);
            }}
            className={HOST_STRIP_ACTION_CLASS}
          >
            Try again
          </button>
        </HostStrip>
      );
    case "unavailable":
      return (
        <HostStrip role="status" onDismiss={onDone}>
          <span>Not editable from the Solver.</span>
          <Link
            href={state.href}
            className={HOST_STRIP_ACTION_CLASS}
          >
            Edit this on the Details page
          </Link>
        </HostStrip>
      );
    case "open":
      return renderView(state.loaded, focus, onFocusClose);
  }
}

/** The loaded Details view in focus mode, keyed by the focus it reads at mount. */
function renderView(
  loaded: ChangeEditorViewProps,
  focus: EditorFocus,
  onFocusClose: (outcome?: "unavailable") => void,
): ReactNode {
  const key = `${focus.kind}:${focus.id}`;
  switch (loaded.page) {
    case "income-expenses":
      return <IncomeExpensesView key={key} {...loaded.props} focus={focus} onFocusClose={onFocusClose} />;
    case "net-worth":
      return <BalanceSheetView key={key} {...loaded.props} focus={focus} onFocusClose={onFocusClose} />;
    case "techniques":
      return <TechniquesView key={key} {...loaded.props} focus={focus} onFocusClose={onFocusClose} />;
    case "family":
      return <FamilyView key={key} {...loaded.props} focus={focus} onFocusClose={onFocusClose} />;
    case "wills":
      return <WillsPanel key={key} {...loaded.props} focus={focus} onFocusClose={onFocusClose} />;
  }
}

/**
 * Where the Details page edits this change, inside the same scenario. A
 * life-insurance account is edited on Insurance, not Net Worth (the Net Worth
 * page routes its policy rows there too); an Assumptions kind opens its tab.
 */
function detailsHref(
  clientId: string,
  scenarioId: string,
  { page, focus }: DetailsEditorTarget,
  lifeInsurance = false,
): string {
  const query = new URLSearchParams();
  let path: string = page;
  if (lifeInsurance) {
    path = "insurance";
    query.set("policy", focus.id);
  }
  const tab = page === "assumptions" ? ASSUMPTIONS_TAB_BY_KIND[focus.kind] : undefined;
  if (tab) query.set("tab", tab);
  query.set("scenario", scenarioId);
  return `/clients/${clientId}/details/${path}?${query.toString()}`;
}

/** The small, quiet line the host's own states render in, above the list. */
function HostStrip({
  role,
  onDismiss,
  children,
}: {
  role: "status" | "alert";
  onDismiss?: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role={role}
      className="mb-2 flex items-center gap-2 rounded-lg border border-hair bg-card px-3 py-2 text-[12px] text-ink-2"
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded px-1 text-ink-3 hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          ×
        </button>
      )}
    </div>
  );
}
