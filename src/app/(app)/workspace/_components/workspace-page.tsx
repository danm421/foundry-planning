"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DialogShell from "@/components/dialog-shell";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { SwitchControl } from "@/components/forms/switch-control";
import { useToast } from "@/components/toast";
import type { AccountSummary, CalendarPaneState as PaneState, WallClock } from "@/lib/workspace/types";
import { addDays, formatWeekRange, localToday, mondayOf, newEventSlot } from "@/lib/workspace/week";
import type { HouseholdOption } from "./add-todo-row";
import { CalendarPaneState, type PaneView } from "./calendar-pane-state";
import { EventEditorDialog, type EventDraft } from "./event-editor-dialog";
import { TodoPanel } from "./todo-panel";
import { WeekCalendar, type WeekEvent } from "./week-calendar";

const WEEKENDS_KEY = "workspace.showWeekends";

/** The connect callback's `?error=` codes that get a banner; any other code gets none. */
const ERROR_BANNERS = new Map([
  ["account_in_use", "That Microsoft account is already connected to another Foundry user."],
  ["wrong_tenant", "Sign in with your work account at your firm."],
  ["connect_declined", "Microsoft sign-in was cancelled."],
  ["connect_failed", "Couldn't connect to Microsoft. Try again."],
]);

/** The panes a Workspace route's 409 (no account, an expired sign-in) or 403 (impersonating) can name. */
const BLOCKING_PANES = new Set<PaneView>(["connect", "needs_reconnect", "impersonating"]);

const MOVE_FAILED = "Couldn't move the meeting — it's back where it was.";
const DISCONNECT_FAILED = "Couldn't disconnect Microsoft 365. Try again.";
const TEAMS_FAILED =
  "Meeting saved without a Teams link — your Microsoft account can't create Teams meetings.";

/** A read week: its meetings, and the display zone they're in (which writes will send). */
type WeekResult = { events: WeekEvent[]; timeZone: string } | { blocked: PaneView };

/** The pane a 409 or 403 names (no account left, an expired sign-in, an impersonation session), or null. */
async function blockingPane(res: Response): Promise<PaneView | null> {
  if (res.status !== 409 && res.status !== 403) return null;
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  const pane = body?.error as PaneView;
  return BLOCKING_PANES.has(pane) ? pane : null;
}

/**
 * Reads one week across every account. Anything but the week itself becomes a
 * pane, never an empty grid: a 409 or 403 names its pane, and every other
 * failure — a 500, a mailbox the provider can't serve, the network — can't
 * load, with a Retry. One account's own failure arrives inside a 200.
 */
async function loadWeek(start: string, signal: AbortSignal): Promise<WeekResult> {
  try {
    const res = await fetch(`/api/workspace/events?start=${start}`, { signal });
    if (res.ok) {
      const body = (await res.json()) as { events?: unknown; timeZone?: unknown };
      if (Array.isArray(body.events) && typeof body.timeZone === "string") {
        return { events: body.events as WeekEvent[], timeZone: body.timeZone };
      }
    } else {
      const pane = await blockingPane(res);
      if (pane) return { blocked: pane };
    }
  } catch {
    // Falls through to "can't load".
  }
  return { blocked: "unavailable" };
}

type WriteResult = { ok: true; body: unknown } | { ok: false; pane: PaneView | null };

/** One Workspace write. A failure carries the pane a 409 or 403 names, if any. */
async function write(url: string, method: "POST" | "PATCH", body?: unknown): Promise<WriteResult> {
  try {
    const res = await fetch(url, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    if (res.ok) return { ok: true, body: await res.json().catch(() => null) };
    return { ok: false, pane: await blockingPane(res) };
  } catch {
    return { ok: false, pane: null };
  }
}

/** An event is written through the account that holds it. */
const eventUrl = (e: { connectionId: string; id: string }) =>
  `/api/workspace/accounts/${e.connectionId}/events/${encodeURIComponent(e.id)}`;

type Times = { start: WallClock; end: WallClock };
type Editor = ({ mode: "create" } & Times) | { mode: "edit"; event: WeekEvent };

const headerButton =
  "inline-flex h-8 items-center justify-center rounded-[var(--radius-sm)] border border-hair-2 px-2.5 text-[12px] text-ink-2 transition-colors hover:border-ink-4 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function WorkspacePage({
  paneState,
  accounts,
  googleEnabled,
  initialWeek,
  userId,
  households,
}: {
  paneState: PaneState;
  /** The advisor's connected addresses, oldest first (none while impersonating). */
  accounts: AccountSummary[];
  /** Google's sign-in is set up on this deployment. */
  googleEnabled: boolean;
  initialWeek: string;
  /** The signed-in advisor: new Foundry tasks from the to-do panel are theirs. */
  userId: string;
  households: HouseholdOption[];
}): ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
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

  // The latest move of each meeting (by `key`) still waiting on its provider.
  // Moves are numbered across the page, so a superseded move can tell it's been overtaken.
  const moveSeq = useRef(0);
  const movesInFlight = useRef(new Map<string, { seq: number } & Times>());

  // A result counts only for the request it answered: a new week or a Retry
  // changes the key, and the pane shows "loading" until that answer lands.
  // A refresh (after a create, a cancel or a move) re-reads under the same key,
  // so the week stays on screen until the new answer replaces it; starting one
  // aborts a read already out, whose answer may predate the write.
  const [attempt, setAttempt] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const requestKey = `${weekStart}#${attempt}`;
  const [result, setResult] = useState<(WeekResult & { key: string; weekStart: string; today: string }) | null>(null);
  useEffect(() => {
    if (paneState !== "ready") return;
    const ctrl = new AbortController();
    void loadWeek(weekStart, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      // A meeting mid-move stays where it was dragged; its own answer settles it.
      const moving = movesInFlight.current;
      const read =
        "events" in r && moving.size > 0
          ? {
              ...r,
              events: r.events.map((e) => {
                const m = moving.get(e.key);
                return m ? { ...e, start: m.start, end: m.end } : e;
              }),
            }
          : r;
      setResult({ ...read, key: requestKey, weekStart, today: localToday() });
    });
    return () => ctrl.abort();
  }, [paneState, weekStart, requestKey, refresh]);

  const current = result?.key === requestKey ? result : null;
  const week = current && "events" in current ? current.events : null;
  const blocked: PaneView | null =
    paneState !== "ready" ? paneState : current && "blocked" in current ? current.blocked : null;
  // While another week loads, the last one stays mounted under a cover, so
  // the grid (and where it's scrolled to) isn't swapped for a loading box.
  const onScreen = current ?? result;
  const shownWeek = onScreen && "events" in onScreen ? onScreen : null;
  const days = showWeekends ? 7 : 5;
  // Writes send the zone the week is shown in, so a wall clock means what the advisor saw.
  const weekZone = current && "events" in current ? current.timeZone : null;

  const [editor, setEditor] = useState<Editor | null>(null);

  function updateEvents(change: (events: WeekEvent[]) => WeekEvent[]) {
    setResult((r) => (r && "events" in r ? { ...r, events: change(r.events) } : r));
  }
  /** A write's 409 named a pane: the calendar shows it in place of the week. */
  function showPane(pane: PaneView) {
    setEditor(null);
    setResult((r) => (r ? { blocked: pane, key: r.key, weekStart: r.weekStart, today: r.today } : r));
  }

  // The phase-1 Disconnect drops every Microsoft address at once, so it's offered for a sole account only.
  const soleAccount = accounts.length === 1 ? accounts[0] : null;
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  /** Drops the sole connected account; the refreshed page shows Connect. */
  async function disconnectMicrosoft(): Promise<void> {
    if (!soleAccount) return;
    setDisconnecting(true);
    const r = await write(`/api/workspace/accounts/${soleAccount.id}/disconnect`, "POST");
    setDisconnecting(false);
    setConfirmDisconnect(false);
    if (r.ok) router.refresh();
    else showToast({ message: DISCONNECT_FAILED });
  }

  /**
   * Optimistic: the meeting moves now. Only the latest move of a meeting acts
   * on its answer (a newer move owns the outcome); a refusal puts it back with
   * a toast, and either way the week is re-read so the screen ends on what
   * Outlook holds.
   */
  async function moveMeeting(key: string, start: WallClock, end: WallClock): Promise<void> {
    const before = week?.find((e) => e.key === key);
    if (!before || !weekZone) return;
    const setTimes = (to: Times) =>
      updateEvents((events) => events.map((e) => (e.key === key ? { ...e, ...to } : e)));
    const seq = ++moveSeq.current;
    movesInFlight.current.set(key, { seq, start, end });
    setTimes({ start, end });

    const r = await write(eventUrl(before), "PATCH", { start, end, timeZone: weekZone });
    if (movesInFlight.current.get(key)?.seq !== seq) return;
    movesInFlight.current.delete(key);
    if (!r.ok && r.pane) {
      showPane(r.pane);
      return;
    }
    if (r.ok) {
      const moved = (r.body as { event?: { start?: unknown; end?: unknown } } | null)?.event;
      if (typeof moved?.start === "string" && typeof moved.end === "string") {
        setTimes({ start: moved.start, end: moved.end });
      }
    } else {
      setTimes({ start: before.start, end: before.end });
      showToast({ message: MOVE_FAILED });
    }
    setRefresh((n) => n + 1);
  }

  /** The editor's Save on an existing meeting is a move like a drag: optimistic, closed at once. */
  async function saveTimes(event: WeekEvent, { start, end }: EventDraft): Promise<void> {
    setEditor(null);
    if (start !== event.start || end !== event.end) void moveMeeting(event.key, start, end);
  }

  async function createMeeting(d: EventDraft): Promise<void> {
    // Until the account picker, a new meeting goes to the first connected account.
    const target = accounts.find((a) => a.status === "connected");
    if (!target || !weekZone) throw new Error("create failed"); // the dialog says so and stays open
    const r = await write(`/api/workspace/accounts/${target.id}/events`, "POST", {
      subject: d.subject,
      start: d.start,
      end: d.end,
      attendees: d.attendees,
      video: d.teams,
      timeZone: weekZone,
    });
    if (!r.ok) {
      if (!r.pane) throw new Error("create failed"); // the dialog says so and stays open
      showPane(r.pane);
      return;
    }
    setEditor(null);
    const teamsFailed = (r.body as { videoFailed?: unknown } | null)?.videoFailed === true;
    if (teamsFailed) showToast({ message: TEAMS_FAILED });
    setRefresh((n) => n + 1); // the server knows `editable` and the household
  }

  async function cancelMeeting(event: WeekEvent): Promise<void> {
    const r = await write(`${eventUrl(event)}/cancel`, "POST");
    if (!r.ok) {
      if (!r.pane) throw new Error("cancel failed");
      showPane(r.pane);
      return;
    }
    setEditor(null);
    updateEvents((events) => events.filter((e) => e.key !== event.key));
    setRefresh((n) => n + 1);
  }

  function openNew() {
    const now = new Date();
    const slot = newEventSlot(weekStart, days, localToday(), now.getHours() * 60 + now.getMinutes());
    setEditor({ mode: "create", ...slot });
  }

  function openMeeting(key: string) {
    const event = week?.find((e) => e.key === key);
    if (event) setEditor({ mode: "edit", event });
  }

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
            // This segment streams in, and the app's password-manager guard
            // marks its input before it hydrates: those attributes are expected.
            suppressHydrationWarning
          />
          <button
            type="button"
            disabled={week === null}
            onClick={openNew}
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
        <div className="min-w-0">
          <div className="overflow-hidden rounded-xl border border-hair bg-card">
            {blocked ? (
              <CalendarPaneState
                state={blocked}
                googleEnabled={googleEnabled}
                onRetry={() => setAttempt((a) => a + 1)}
              />
            ) : shownWeek ? (
              <div className="relative" aria-busy={current === null}>
                <WeekCalendar
                  weekStart={shownWeek.weekStart}
                  days={days}
                  events={shownWeek.events}
                  today={shownWeek.today}
                  onMove={moveMeeting}
                  onOpen={openMeeting}
                />
                {current === null ? (
                  <div className="absolute inset-0 z-30 flex items-center justify-center bg-card/70">
                    <p role="status" className="text-sm text-ink-3">
                      Loading your week…
                    </p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex min-h-[360px] items-center justify-center">
                <p role="status" className="text-sm text-ink-3">
                  Loading your week…
                </p>
              </div>
            )}
          </div>
          {paneState === "ready" && soleAccount ? (
            <p className="mt-2 text-[12px] text-ink-3">
              Connected as <span className="text-ink-2">{soleAccount.email}</span> ·{" "}
              <button
                type="button"
                onClick={() => setConfirmDisconnect(true)}
                className="underline underline-offset-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Disconnect
              </button>
            </p>
          ) : null}
        </div>
        {/* Beside every calendar state: Foundry tasks don't wait on Microsoft.
            A new connection state (after Disconnect) reads the to-dos afresh. */}
        <TodoPanel key={paneState} userId={userId} households={households} />
      </div>

      <DialogShell
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect Microsoft 365?"
        size="sm"
        destructiveAction={{ label: "Disconnect", onClick: disconnectMicrosoft, loading: disconnecting }}
      >
        <p className="text-[14px] text-ink-2">
          Your Outlook calendar and to-dos leave Workspace. You can connect again any time.
        </p>
      </DialogShell>

      {editor?.mode === "create" ? (
        <EventEditorDialog
          mode="create"
          initial={{
            subject: "",
            start: editor.start,
            end: editor.end,
            attendees: [],
            meetingUrl: null,
          }}
          onSave={createMeeting}
          onClose={() => setEditor(null)}
        />
      ) : editor?.mode === "edit" ? (
        <EventEditorDialog
          mode="edit"
          initial={{
            subject: editor.event.subject,
            start: editor.event.start,
            end: editor.event.end,
            attendees: editor.event.attendees.map((a) => a.email),
            meetingUrl: editor.event.meetingUrl,
          }}
          onSave={(draft) => saveTimes(editor.event, draft)}
          onCancelMeeting={() => cancelMeeting(editor.event)}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </div>
  );
}
