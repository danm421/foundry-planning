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
// - "failed" → the editor opened and the save or delete did not land → unmount
//   the view and say so, instead of closing as if the change had been made.
// - "unavailable" → the Details page itself wouldn't open this row here
//   (Ruling T4-unavailable) → unmount the view, show a link to that page.
// - "unsupported" → the row's editor would write the base plan inside a
//   scenario (Ruling F-I2; e.g. a recurring gift in the scenario's own series
//   partition) → unmount the view, explain, and link nowhere: the Details page
//   has the same bug.
//
// With no scenario selected the view writes the base facts, as on the Details
// page. The host then says so (`BaseFactsEditProvider`: a line atop the dialog,
// and a confirm before the first save), except for a delete the Changes tab
// has already confirmed. A few base-only sub-tabs (a Schedule override, the
// Medicare tab, a debt's extra payments) save on their own, past the writer —
// unconfirmed, and without refreshing the route — and a trust's beneficiaries
// land after its own refresh, so the host re-reads the plan whenever a base
// editor closes, even when a save just did.
//
// The views are loaded with next/dynamic so five large Details views stay out
// of the Solver's initial bundle.

import { createContext, startTransition, useContext, useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  focusRowId,
  type ChangeEditorTarget,
  type DetailsEditorPage,
  type EditorFocus,
} from "@/lib/scenario/change-editor-target";
import type { FocusCloseOutcome } from "@/hooks/use-focus-close-once";
import { ScenarioWriteListener, type ScenarioWriteEvent } from "@/hooks/scenario-write-listener";
import { useScenarioState } from "@/hooks/use-scenario-state";
import { BASE_FACTS_SAVE_CONFIRM, BaseFactsEditProvider, type BaseFactsEdit } from "@/hooks/base-facts-edit";
import { loadChangeEditorProps, type ChangeEditorViewProps } from "./change-editor-actions";

// While a delete runs the host shows its own "Removing {label}…" strip, in every
// loading state; the views' lazy-load fallbacks then render nothing, so the
// advisor never sees "Opening the editor…" for a delete.
const RemovingCtx = createContext(false);
const LoadingLine = () => {
  const removing = useContext(RemovingCtx);
  return removing ? null : <HostStrip role="status">Opening the editor…</HostStrip>;
};

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
const InsurancePanel = dynamic(() => import("@/components/insurance-panel"), { loading: LoadingLine });
const DisabilityPanel = dynamic(() => import("@/components/disability-panel"), { loading: LoadingLine });
const LtcPanel = dynamic(() => import("@/components/ltc-panel"), { loading: LoadingLine });
const AssumptionsClient = dynamic(
  () => import("@/app/(app)/clients/[id]/details/assumptions/assumptions-client"),
  { loading: LoadingLine },
);

// Shared by the "Try again" button and the fallback Details-page link below —
// both are a `HostStrip`'s one inline action.
const HOST_STRIP_ACTION_CLASS =
  "font-medium text-ink hover:text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded";

/** A change the resolver sends to a Details page. */
export type DetailsEditorTarget = Extract<ChangeEditorTarget, { surface: "details" }>;

/** A change the host opens: a Details editor. */
export type EditorHostTarget = DetailsEditorTarget;

interface Props {
  clientId: string;
  /** The scenario a save writes into, or null for the base case: the view then
   *  writes the base facts, as it does on the Details page. */
  scenarioId: string | null;
  target: EditorHostTarget;
  /** What the editor is about, in the advisor's words: "Removing {label}…". */
  label: string;
  /** The editor closed normally, or the advisor dismissed a message. */
  onDone: () => void;
  /** Every scenario write the mounted view reports. */
  onWrite?: (event: ScenarioWriteEvent) => void;
}

type HostState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "open"; loaded: ChangeEditorViewProps }
  | { status: "failed" }
  | { status: "unavailable"; href: string }
  | { status: "unsupported" };

export function SolverChangeEditor({
  clientId,
  scenarioId,
  target,
  label,
  onDone,
  onWrite,
}: Props) {
  const { page, focus } = target;
  const focusId = focusRowId(focus);
  const router = useRouter();
  // The views write wherever the URL's `?scenario=` points. Told "base case"
  // while the URL names a scenario (the base case's own id, typed by hand), the
  // editor would say "base facts" and write a scenario change: open nothing.
  // (Two sources of truth; the deeper fix is one the writer and host share.)
  const urlScenarioId = useScenarioState(clientId).scenarioId;
  const writesElsewhere = scenarioId === null && urlScenarioId !== null;
  const [state, setState] = useState<HostState>({ status: "loading" });
  const deleting = focus.intent === "delete";
  // One per mount: the host is mounted fresh for every click.
  const [baseFacts] = useState<BaseFactsEdit | null>(() =>
    scenarioId === null ? askOnce(deleting) : null,
  );
  // Bumped by "Try again" to re-run the load.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (writesElsewhere) return;
    let cancelled = false;
    startTransition(async () => {
      try {
        let loaded = await loadChangeEditorProps(clientId, scenarioId ?? "base", page);
        // A life policy is an `account` change, so the resolver sends it to Net
        // Worth, whose editor won't open it. Its editor is Insurance: reload
        // the page that owns it.
        if (isLifePolicyOnNetWorth(loaded, focusId)) {
          loaded = await loadChangeEditorProps(clientId, scenarioId ?? "base", "insurance");
        }
        if (!cancelled) setState({ status: "open", loaded });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [clientId, scenarioId, page, focusId, attempt, writesElsewhere]);

  function onFocusClose(outcome?: FocusCloseOutcome) {
    if (baseFacts && (outcome === undefined || outcome === "failed")) router.refresh();
    if (outcome === undefined) {
      onDone();
      return;
    }
    if (outcome === "unsupported") {
      setState({ status: "unsupported" });
      return;
    }
    if (outcome === "failed") {
      setState({ status: "failed" });
      return;
    }
    setState({ status: "unavailable", href: detailsHref(clientId, scenarioId, state.status === "open" ? state.loaded.page : page) });
  }

  function stateView(): ReactNode {
    if (writesElsewhere) {
      return (
        <HostStrip role="alert" onDismiss={onDone}>
          <span className="text-crit">Couldn&apos;t open this editor.</span>
        </HostStrip>
      );
    }
    switch (state.status) {
      case "loading":
        return deleting ? <HostStrip role="status">Removing {label}…</HostStrip> : <LoadingLine />;
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
      case "failed":
        return (
          <HostStrip role="alert" onDismiss={onDone}>
            <span className="text-crit">Couldn&apos;t remove {label}.</span>
          </HostStrip>
        );
      case "unavailable":
        // A delete's row has vanished (removed elsewhere, or by a cascade):
        // there is nothing left to remove, and no editor to point at.
        if (deleting) {
          return (
            <HostStrip role="status" onDismiss={onDone}>
              <span>This item is no longer in the plan.</span>
            </HostStrip>
          );
        }
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
      case "unsupported":
        return <UnsupportedStrip onDismiss={onDone} />;
      case "open":
        return (
          <>
            {deleting && <HostStrip role="status">Removing {label}…</HostStrip>}
            <BaseFactsEditProvider value={baseFacts}>
              <ScenarioWriteListener value={onWrite ?? null}>
                {renderView(state.loaded, focus, onFocusClose)}
              </ScenarioWriteListener>
            </BaseFactsEditProvider>
          </>
        );
    }
  }

  return <RemovingCtx.Provider value={deleting}>{stateView()}</RemovingCtx.Provider>;
}

/** Asks before the editor's first base write and remembers a yes; `confirmed` skips the question. */
function askOnce(confirmed: boolean): BaseFactsEdit {
  return { confirmSave: () => (confirmed ||= window.confirm(BASE_FACTS_SAVE_CONFIRM)) };
}

/** Ruling F-I2: no link — the Details page's editor has the same bug. */
function UnsupportedStrip({ onDismiss }: { onDismiss: () => void }) {
  return (
    <HostStrip role="status" onDismiss={onDismiss}>
      <span>
        This change can&apos;t be edited inside a scenario yet. You can still switch it off or
        delete it here.
      </span>
    </HostStrip>
  );
}

/** The loaded Details view in focus mode, keyed by the whole focus it reads at mount. */
function renderView(
  loaded: ChangeEditorViewProps,
  focus: EditorFocus,
  onFocusClose: (outcome?: FocusCloseOutcome) => void,
): ReactNode {
  const key = JSON.stringify(focus);
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
    case "insurance":
      // One page, three panels: the focus decides which one mounts.
      if (focus.kind === "disability_policy") {
        return <DisabilityPanel key={key} {...loaded.disabilityProps} focus={focus} onFocusClose={onFocusClose} />;
      }
      if (focus.kind === "ltc_policy") {
        return <LtcPanel key={key} {...loaded.ltcProps} focus={focus} onFocusClose={onFocusClose} />;
      }
      return <InsurancePanel key={key} {...loaded.props} focus={focus} onFocusClose={onFocusClose} />;
    case "assumptions":
      return <AssumptionsClient key={key} {...loaded.props} focus={focus} onFocusClose={onFocusClose} />;
  }
}

/** True when `loaded` is Net Worth and the focused account on it is a life policy. */
function isLifePolicyOnNetWorth(loaded: ChangeEditorViewProps, focusId: string | null): boolean {
  return (
    focusId !== null &&
    loaded.page === "net-worth" &&
    loaded.props.accounts.some((a) => a.id === focusId && a.category === "life_insurance")
  );
}

/** Where the Details page edits this change, inside the same scenario (or the base case). */
function detailsHref(clientId: string, scenarioId: string | null, page: DetailsEditorPage): string {
  const path = `/clients/${clientId}/details/${page}`;
  return scenarioId ? `${path}?${new URLSearchParams({ scenario: scenarioId }).toString()}` : path;
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
