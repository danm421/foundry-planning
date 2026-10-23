"use client";

// Opens one Details-page editor inside the Solver, in hold mode: the view is
// wrapped in `HeldEditsProvider`, so a save or remove goes to `host.hold` as an
// unsaved change and nothing is written. Loads the page's view props through the `loadChangeEditorProps` server
// action, then mounts that Details view in focus mode — which renders only the
// row's own dialog, as a fixed overlay. Mounted fresh for every click (the
// Changes tab keys it), so each instance loads exactly one target.
//
// Outcomes the view reports through `onFocusClose`:
// - no argument → the editor closed (cancel, save, delete…) → `onDone()`
//   unmounts everything. A save was already handed to `host.hold`.
// - "failed" → the editor opened and the save or delete did not land → unmount
//   the view and say so, instead of closing as if the change had been made.
// - "unavailable" → the Details page itself wouldn't open this row here
//   (Ruling T4-unavailable) → unmount the view, show a link to that page.
// - "unsupported" → the row's editor would write the base plan inside a
//   scenario (Ruling F-I2; e.g. a recurring gift in the scenario's own series
//   partition) → unmount the view, explain, and link nowhere: the Details page
//   has the same bug.
//
// An item whose saved change is in a switched-off group opens nothing: the host
// says to switch it on first.
//
// The views are loaded with next/dynamic so five large Details views stay out
// of the Solver's initial bundle.

import { createContext, startTransition, useContext, useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  focusRowId,
  type ChangeEditorTarget,
  type DetailsEditorPage,
  type EditorFocus,
} from "@/lib/scenario/change-editor-target";
import type { FocusCloseOutcome } from "@/hooks/use-focus-close-once";
import { HeldEditsProvider } from "@/hooks/held-edits";
import type { ScenarioEdit } from "@/hooks/use-scenario-writer";
import type { SolverMutation, SolverSource } from "@/lib/solver/types";
import { useScenarioState } from "@/hooks/use-scenario-state";
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

/** What the Solver gives every editor it hosts: where to load from, and where saves go. */
export interface HeldEditorHost {
  /** "base" or the source scenario's id. */
  source: SolverSource;
  /** The switched-on list the editor opens on. */
  mutations: SolverMutation[];
  /** Every save lands here, as unsaved changes; nothing is written. */
  hold: (edits: ScenarioEdit[]) => Promise<Response>;
  /** Items whose SAVED change is in a switched-off group. */
  switchedOffIds: ReadonlySet<string>;
}

interface Props {
  clientId: string;
  host: HeldEditorHost;
  target: EditorHostTarget;
  /** What the editor is about, in the advisor's words: "Removing {label}…". */
  label: string;
  /** The editor closed normally, or the advisor dismissed a message. */
  onDone: () => void;
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
  host,
  target,
  label,
  onDone,
}: Props) {
  const { page, focus } = target;
  const focusId = focusRowId(focus);
  const { source, mutations } = host;
  const scenarioId = source === "base" ? null : source;
  // Held edits never write, but the views still read `?scenario=` for their own
  // labels. Told "base" while the URL names a scenario (the base case's own id,
  // typed by hand), they would label it wrongly: open nothing.
  const urlScenarioId = useScenarioState(clientId).scenarioId;
  const writesElsewhere = source === "base" && urlScenarioId !== null;
  const switchedOff = focusId !== null && host.switchedOffIds.has(focusId);
  const [state, setState] = useState<HostState>({ status: "loading" });
  const deleting = focus.intent === "delete";
  // Bumped by "Try again" to re-run the load.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (writesElsewhere || switchedOff) return;
    let cancelled = false;
    startTransition(async () => {
      try {
        let loaded = await loadChangeEditorProps(clientId, source, page, mutations);
        // A life policy is an `account` change, so the resolver sends it to Net
        // Worth, whose editor won't open it. Its editor is Insurance: reload
        // the page that owns it.
        if (isLifePolicyOnNetWorth(loaded, focusId)) {
          loaded = await loadChangeEditorProps(clientId, source, "insurance", mutations);
        }
        if (!cancelled) setState({ status: "open", loaded });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [clientId, source, mutations, page, focusId, attempt, writesElsewhere, switchedOff]);

  function onFocusClose(outcome?: FocusCloseOutcome) {
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
    if (switchedOff) {
      return (
        <HostStrip role="status" onDismiss={onDone}>
          <span>This item has a saved change that&apos;s switched off. Switch it on to edit it here.</span>
        </HostStrip>
      );
    }
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
            <HeldEditsProvider value={{ hold: host.hold }}>
              {renderView(state.loaded, focus, onFocusClose)}
            </HeldEditsProvider>
          </>
        );
    }
  }

  return <RemovingCtx.Provider value={deleting}>{stateView()}</RemovingCtx.Provider>;
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
