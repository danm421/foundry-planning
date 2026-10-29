"use client";

import { useEffect, useState, type ReactElement } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { SwitchControl } from "@/components/forms/switch-control";
import type { CalendarPaneState as PaneState } from "@/lib/workspace/types";
import { addDays, formatWeekRange, mondayOf } from "@/lib/workspace/week";
import { CalendarPaneState, type PaneView } from "./calendar-pane-state";
import { WeekCalendar, type WeekEvent } from "./week-calendar";

const WEEKENDS_KEY = "workspace.showWeekends";

/** The connect callback's `?error=` codes that get a banner. `member_off` and
 *  `firm_not_approved` get none: the calendar pane already says it. */
const ERROR_BANNERS = new Map([
  ["account_in_use", "That Microsoft account is already connected to another Foundry user."],
  ["wrong_tenant", "Sign in with your work account at your firm."],
  ["connect_declined", "Microsoft sign-in was cancelled."],
  ["connect_failed", "Couldn't connect to Microsoft. Try again."],
]);

/** The pane states a 409 from the events route can name. */
const CONFLICT_PANES = new Set<PaneView>(["firm_not_approved", "member_off", "connect", "needs_reconnect"]);

type WeekResult = { events: WeekEvent[] } | { blocked: PaneView };

/**
 * Reads one week. Anything but the week itself becomes a pane, never an empty
 * grid: a 409 names its pane (an expired sign-in, a switched-off advisor) and
 * every other failure — Microsoft throttling, a 500, the network — reads as
 * "busy", whose Retry asks again.
 */
async function loadWeek(start: string, signal: AbortSignal): Promise<WeekResult> {
  try {
    const res = await fetch(`/api/workspace/events?start=${start}`, { signal });
    if (res.ok) {
      const body = (await res.json()) as { events?: unknown };
      if (Array.isArray(body.events)) return { events: body.events as WeekEvent[] };
    } else if (res.status === 409) {
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
      const pane = body?.error as PaneView;
      if (CONFLICT_PANES.has(pane)) return { blocked: pane };
    }
  } catch {
    // Falls through to "busy".
  }
  return { blocked: "throttled" };
}

/** Today in the browser's zone. The mailbox zone's "today" isn't derivable
 *  from Outlook's Windows zone names, so this is the accepted stand-in. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const headerButton =
  "inline-flex h-8 items-center justify-center rounded-[var(--radius-sm)] border border-hair-2 px-2.5 text-[12px] text-ink-2 transition-colors hover:border-ink-4 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function WorkspacePage({
  paneState,
  isAdmin,
  initialWeek,
}: {
  paneState: PaneState;
  isAdmin: boolean;
  initialWeek: string;
}): ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Read once: clearing the query below must not take the banner with it.
  const [flash] = useState(() => {
    const code = searchParams.get("error");
    return {
      banner:
        searchParams.get("connected") === "1"
          ? "Microsoft 365 connected."
          : (code && ERROR_BANNERS.get(code)) || null,
      hadQuery: searchParams.has("connected") || code !== null,
    };
  });
  useEffect(() => {
    if (flash.hadQuery) router.replace("/workspace");
  }, [flash.hadQuery, router]);

  const [weekStart, setWeekStart] = useState(initialWeek);
  const [showWeekends, setShowWeekends] = useState(false);
  // Read after mount, not in the initializer: the server render can't see
  // storage, and a different first client render would be a hydration mismatch.
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot localStorage hydration on mount; nothing depends on it, so no cascade.
      if (localStorage.getItem(WEEKENDS_KEY) === "true") setShowWeekends(true);
    } catch {
      // Storage blocked: weekends stay hidden.
    }
  }, []);
  function toggleWeekends(next: boolean) {
    setShowWeekends(next);
    try {
      localStorage.setItem(WEEKENDS_KEY, String(next));
    } catch {
      // Storage blocked: the choice lasts for this visit only.
    }
  }

  // A result counts only for the request it answered: a new week or a Retry
  // changes the key, and the pane shows "loading" until that answer lands.
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${weekStart}#${attempt}`;
  const [result, setResult] = useState<(WeekResult & { key: string; today: string }) | null>(null);
  useEffect(() => {
    if (paneState !== "ready") return;
    const ctrl = new AbortController();
    void loadWeek(weekStart, ctrl.signal).then((r) => {
      if (!ctrl.signal.aborted) setResult({ ...r, key: requestKey, today: localToday() });
    });
    return () => ctrl.abort();
  }, [paneState, weekStart, requestKey]);

  const current = result?.key === requestKey ? result : null;
  const blocked: PaneView | null =
    paneState !== "ready" ? paneState : current && "blocked" in current ? current.blocked : null;
  const days = showWeekends ? 7 : 5;

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 p-[var(--pad-card)]">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[22px] font-semibold leading-[1.25] tracking-[-0.015em] text-ink">
          Workspace<span className="dot">.</span>
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-label="Previous week"
            className={headerButton}
            onClick={() => setWeekStart((w) => addDays(w, -7))}
          >
            <ChevronLeftIcon width={14} height={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={headerButton}
            onClick={() => setWeekStart(mondayOf(localToday()))}
          >
            Today
          </button>
          <button
            type="button"
            aria-label="Next week"
            className={headerButton}
            onClick={() => setWeekStart((w) => addDays(w, 7))}
          >
            <ChevronRightIcon width={14} height={14} aria-hidden="true" />
          </button>
          <span className="tabular mx-2 text-[13px] text-ink-2">{formatWeekRange(weekStart, days)}</span>
          <SwitchControl
            checked={showWeekends}
            onChange={toggleWeekends}
            ariaLabel="Show weekends"
            stateLabel="Show weekends"
          />
          <button
            type="button"
            disabled={blocked !== null}
            className="ml-1 inline-flex h-8 items-center rounded-[var(--radius-sm)] bg-accent px-3 text-[12px] font-semibold text-accent-on transition-colors hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent"
          >
            + New event
          </button>
        </div>
      </header>

      {flash.banner ? (
        <p role="status" className="rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2 text-sm text-ink-2">
          {flash.banner}
        </p>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 overflow-hidden rounded-xl border border-hair bg-card">
          {blocked ? (
            <CalendarPaneState state={blocked} isAdmin={isAdmin} onRetry={() => setAttempt((a) => a + 1)} />
          ) : current && "events" in current ? (
            <WeekCalendar weekStart={weekStart} days={days} events={current.events} today={current.today} />
          ) : (
            <div className="flex min-h-[360px] items-center justify-center">
              <p role="status" className="text-sm text-ink-3">
                Loading your week…
              </p>
            </div>
          )}
        </div>
        {/* The to-do list mounts here. */}
        <aside aria-label="To-dos" className="rounded-xl border border-hair bg-card p-4">
          <h2 className="text-sm font-semibold text-ink">To-dos</h2>
        </aside>
      </div>
    </div>
  );
}
