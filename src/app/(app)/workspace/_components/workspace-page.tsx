"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DialogShell from "@/components/dialog-shell";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { SwitchControl } from "@/components/forms/switch-control";
import { useToast } from "@/components/toast";
import { accountLabels } from "@/lib/workspace/accounts";
import { isValidIanaZone, zoneLabel } from "@/lib/workspace/time-zones";
import type {
  AccountError,
  AccountSummary,
  CalendarPaneState as PaneState,
  WallClock,
} from "@/lib/workspace/types";
import { addDays, formatWeekRange, localToday, mondayOf, newEventSlot } from "@/lib/workspace/week";
import type { HouseholdOption } from "./add-todo-row";
import { AccountBanners } from "./account-banners";
import { AccountBar } from "./account-bar";
import { CalendarPaneState, type PaneView } from "./calendar-pane-state";
import { EventEditorDialog, type EventDraft } from "./event-editor-dialog";
import { TodoPanel } from "./todo-panel";
import { WeekCalendar, type WeekEvent } from "./week-calendar";

const WEEKENDS_KEY = "workspace.showWeekends";
const HIDDEN_ACCOUNTS_KEY = "workspace.hiddenAccounts";

/** The connect callback's `?error=` codes that get a banner; any other code gets none. */
const ERROR_BANNERS = new Map([
  ["too_many_accounts", "You've connected 5 addresses, the most Workspace allows. Disconnect one to add another."],
  ["missing_permissions", "Foundry needs both your calendar and your tasks. Connect again and leave both boxes ticked."],
  ["google_blocked", "Your Google administrator hasn't allowed Foundry Planning. The steps for them are under + Add account."],
  ["needs_admin_approval", "Your Microsoft organization needs an admin to approve Foundry Planning. The link for them is under + Add account."],
  ["connect_declined", "Sign-in was cancelled."],
  ["connect_failed", "Couldn't connect. Try again."],
  ["impersonating", "Connecting is turned off while you're signed in as someone else."],
]);

/** The banner for a connect redirect's query (`?connected=` or `?error=`, with `&provider=` on account_in_use), or null. */
function connectBanner(params: URLSearchParams): string | null {
  const connected = params.get("connected");
  if (connected === "google") return "Google connected.";
  if (connected === "microsoft") return "Microsoft 365 connected.";
  const code = params.get("error");
  if (code === "account_in_use") {
    return `That ${params.get("provider") === "google" ? "Google" : "Microsoft"} account is already connected to another Foundry user.`;
  }
  return (code && ERROR_BANNERS.get(code)) || null;
}

const TIME_ZONE_FALLBACK = "Times in UTC — none of your accounts reports a time zone.";

/** The panes a Workspace route's 409 (no account) or 403 (impersonating) can name. */
const BLOCKING_PANES: ReadonlySet<unknown> = new Set<PaneView>(["connect", "impersonating"]);

const MOVE_FAILED = "Couldn't move the meeting — it's back where it was.";
const VIDEO_FAILED = {
  microsoft: "Meeting saved without a Teams link — your Microsoft account can't create Teams meetings.",
  google: "Meeting saved without a Google Meet link — Google couldn't create one for this account.",
} as const;

/** One account's half of a read week: null when it loaded. */
type AccountResult = { connectionId: string; error: AccountError | null };

/** A read week: its meetings, each account's outcome, and the display zone they're in (which writes will send). */
type WeekResult =
  | { events: WeekEvent[]; accounts: AccountResult[]; timeZone: string; timeZoneFallback: boolean }
  | { blocked: PaneView };

/**
 * What a refused request names: a pane (no account left, an impersonation
 * session), or a write's 409 `needs_reconnect` — one account's expired
 * sign-in, which is that account's banner, never a pane (see `writeBlocked`).
 */
type Refusal = PaneView | "needs_reconnect";

/** What a 409 or 403 names, or null. */
async function refusalOf(res: Response): Promise<Refusal | null> {
  if (res.status !== 409 && res.status !== 403) return null;
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  const error = body?.error;
  return error === "needs_reconnect" || BLOCKING_PANES.has(error) ? (error as Refusal) : null;
}

/**
 * Reads one week across every account but the hidden ones (`hidden`, a
 * comma-separated query value; the server leaves them out before it dedupes).
 * Anything but the week itself becomes a pane, never an empty grid: a 409 or
 * 403 names its pane, and every other failure — a 500, a mailbox the provider
 * can't serve, the network — can't load, with a Retry. One account's own
 * failure arrives inside a 200.
 */
async function loadWeek(start: string, hidden: string, signal: AbortSignal): Promise<WeekResult> {
  try {
    const res = await fetch(`/api/workspace/events?start=${start}${hidden ? `&hidden=${hidden}` : ""}`, { signal });
    if (res.ok) {
      const body = (await res.json()) as {
        events?: unknown;
        accounts?: unknown;
        timeZone?: unknown;
        timeZoneFallback?: unknown;
      };
      if (Array.isArray(body.events) && typeof body.timeZone === "string") {
        return {
          events: body.events as WeekEvent[],
          accounts: Array.isArray(body.accounts) ? (body.accounts as AccountResult[]) : [],
          timeZone: body.timeZone,
          timeZoneFallback: body.timeZoneFallback === true,
        };
      }
    } else {
      // The week never answers needs_reconnect (each account's failure arrives in a 200); one that did can't load.
      const pane = await refusalOf(res);
      if (pane && pane !== "needs_reconnect") return { blocked: pane };
    }
  } catch {
    // Falls through to "can't load".
  }
  return { blocked: "unavailable" };
}

type WriteResult = { ok: true; body: unknown } | { ok: false; pane: Refusal | null };

/** One Workspace write. A failure carries what a 409 or 403 names, if anything. */
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
    return { ok: false, pane: await refusalOf(res) };
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
  itApprovalUrl,
  googleClientId,
  initialWeek,
  userId,
  households,
}: {
  paneState: PaneState;
  /** The advisor's connected addresses, oldest first (none while impersonating). */
  accounts: AccountSummary[];
  /** Google's sign-in is set up on this deployment. */
  googleEnabled: boolean;
  /** Where a Microsoft organization's admin approves Foundry; null where Microsoft isn't set up. */
  itApprovalUrl: string | null;
  /** Google's OAuth client id (for the admin who must allow it); null when Google is off. */
  googleClientId: string | null;
  initialWeek: string;
  /** The signed-in advisor: new Foundry tasks from the to-do panel are theirs. */
  userId: string;
  households: HouseholdOption[];
}): ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  // Read once: clearing the query below must not take the banner with it.
  const [flash] = useState(() => ({
    banner: connectBanner(searchParams),
    hadQuery: searchParams.has("connected") || searchParams.has("error"),
  }));
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

  // Accounts the advisor has hidden from the week: kept on this device, read like the weekends choice.
  // Null until storage is read: the week waits for it, so the first read already leaves them out.
  const [hidden, setHidden] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    let stored: string[] = [];
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(HIDDEN_ACCOUNTS_KEY) ?? "[]");
      if (Array.isArray(parsed)) stored = parsed.filter((id): id is string => typeof id === "string");
    } catch {
      // Storage blocked or unreadable: every account shows.
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot localStorage hydration on mount; the week read waits on it.
    setHidden(new Set(stored));
  }, []);
  // Hiding exists only on the chips (2+ accounts): a sole account is never hidden, whatever storage still holds.
  const shownHidden: ReadonlySet<string> =
    hidden && accounts.length >= 2 ? new Set(accounts.filter((a) => hidden.has(a.id)).map((a) => a.id)) : new Set();
  // What the week read sends: a Hide or Show changes it, and so re-reads the week.
  const hiddenQuery = hidden === null ? null : [...shownHidden].map(encodeURIComponent).join(",");
  function toggleHidden(connectionId: string) {
    const next = new Set(shownHidden);
    if (!next.delete(connectionId)) next.add(connectionId);
    setHidden(next);
    try {
      localStorage.setItem(HIDDEN_ACCOUNTS_KEY, JSON.stringify([...next]));
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
  // A refresh (after a create, a cancel or a move) or a Hide/Show re-reads
  // under the same key, so the week stays on screen until the new answer
  // replaces it; starting one aborts a read already out, whose answer may
  // predate the change.
  const [attempt, setAttempt] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const requestKey = `${weekStart}#${attempt}`;
  const [result, setResult] = useState<(WeekResult & { key: string; weekStart: string; today: string }) | null>(null);
  useEffect(() => {
    if (paneState !== "ready" || hiddenQuery === null) return;
    const ctrl = new AbortController();
    void loadWeek(weekStart, hiddenQuery, ctrl.signal).then((r) => {
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
  }, [paneState, weekStart, hiddenQuery, requestKey, refresh]);

  const current = result?.key === requestKey ? result : null;
  const week = current && "events" in current ? current.events : null;
  const blocked: PaneView | null =
    paneState !== "ready" ? paneState : current && "blocked" in current ? current.blocked : null;
  // While another week loads, the last one stays mounted under a cover, so
  // the grid (and where it's scrolled to) isn't swapped for a loading box.
  const onScreen = current ?? result;
  const shownWeek = onScreen && "events" in onScreen ? onScreen : null;
  const days = showWeekends ? 7 : 5;
  const labels = accounts.length >= 2 ? accountLabels(accounts) : null;
  // With 2+ accounts each meeting names its address: the short label, and the full address on hover and in the editor.
  const tags = labels && new Map(accounts.map((a) => [a.id, { label: labels.get(a.id) ?? a.email, email: a.email }]));
  // A meeting shows when its account is still connected and not hidden. The
  // server already leaves hidden accounts out; this covers the moment between
  // a Hide, or a Disconnect, and the re-read that follows it.
  const liveIds = new Set(accounts.map((a) => a.id));
  const isShown = (e: WeekEvent) => liveIds.has(e.connectionId) && !shownHidden.has(e.connectionId);
  const visibleEvents = shownWeek ? shownWeek.events.filter(isShown) : [];
  // The zone line follows the week on screen; a missing, invalid or fallback zone reads as the fixed UTC line.
  const zoneLine = shownWeek
    ? shownWeek.timeZoneFallback || !isValidIanaZone(shownWeek.timeZone)
      ? TIME_ZONE_FALLBACK
      : `Times in ${zoneLabel(shownWeek.timeZone)}`
    : null;
  // Writes send the zone the week is shown in, so a wall clock means what the advisor saw.
  const weekZone = current && "events" in current ? current.timeZone : null;

  const [editor, setEditor] = useState<Editor | null>(null);
  // A new meeting can go on any connected account that isn't hidden.
  const pickable = accounts.filter((a) => a.status === "connected" && !shownHidden.has(a.id));

  function updateEvents(change: (events: WeekEvent[]) => WeekEvent[]) {
    setResult((r) => (r && "events" in r ? { ...r, events: change(r.events) } : r));
  }
  /**
   * A write's 409 or 403 named a pane. `needs_reconnect` names one account, not
   * the whole pane: re-read, so that account's banner shows and the others stay.
   * Any other pane shows in place of the week.
   */
  function writeBlocked(pane: Refusal) {
    setEditor(null);
    if (pane === "needs_reconnect") {
      setRefresh((n) => n + 1);
      router.refresh(); // the server's account statuses: the chip's Reconnect, and the picker stops offering it
      return;
    }
    setResult((r) => (r ? { blocked: pane, key: r.key, weekStart: r.weekStart, today: r.today } : r));
  }

  // The account whose Disconnect is awaiting its confirm.
  const [disconnectTarget, setDisconnectTarget] = useState<AccountSummary | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  /**
   * Drops the confirmed account: the week is re-read without its meetings, and
   * the refreshed page lists the rest, or shows Connect.
   */
  async function disconnectAccount(): Promise<void> {
    if (!disconnectTarget) return;
    setDisconnecting(true);
    const r = await write(`/api/workspace/accounts/${disconnectTarget.id}/disconnect`, "POST");
    setDisconnecting(false);
    setDisconnectTarget(null);
    if (r.ok) {
      setRefresh((n) => n + 1);
      router.refresh();
    } else showToast({ message: `Couldn't disconnect ${disconnectTarget.email}. Try again.` });
  }

  /**
   * Optimistic: the meeting moves now. Only the latest move of a meeting acts
   * on its answer (a newer move owns the outcome); a refusal puts it back with
   * a toast, and either way the week is re-read so the screen ends on what
   * Outlook holds.
   */
  async function moveMeeting(key: string, start: WallClock, end: WallClock): Promise<void> {
    const before = week?.find((e) => e.key === key && isShown(e));
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
      // Back where it was; any pane but needs_reconnect replaces the week anyway.
      setTimes({ start: before.start, end: before.end });
      writeBlocked(r.pane);
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
    const target = accounts.find((a) => a.id === d.connectionId);
    if (!target || !weekZone) throw new Error("create failed"); // the dialog says so and stays open
    const r = await write(`/api/workspace/accounts/${target.id}/events`, "POST", {
      subject: d.subject,
      start: d.start,
      end: d.end,
      attendees: d.attendees,
      video: d.video,
      timeZone: weekZone,
    });
    if (!r.ok) {
      if (!r.pane) throw new Error("create failed"); // the dialog says so and stays open
      writeBlocked(r.pane);
      return;
    }
    setEditor(null);
    const videoFailed = (r.body as { videoFailed?: unknown } | null)?.videoFailed === true;
    if (videoFailed) showToast({ message: VIDEO_FAILED[target.provider] });
    setRefresh((n) => n + 1); // the server knows `editable` and the household
  }

  async function cancelMeeting(event: WeekEvent): Promise<void> {
    const r = await write(`${eventUrl(event)}/cancel`, "POST");
    if (!r.ok) {
      if (!r.pane) throw new Error("cancel failed");
      writeBlocked(r.pane);
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
    const event = week?.find((e) => e.key === key && isShown(e));
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
          {zoneLine ? <span className="tabular text-[12px] text-ink-3">{zoneLine}</span> : null}
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
            disabled={blocked !== null || week === null || pickable.length === 0}
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
        <div className="flex min-w-0 flex-col gap-2">
          {accounts.length > 0 ? (
            <AccountBar
              accounts={accounts}
              labels={labels}
              hidden={shownHidden}
              onToggleHidden={toggleHidden}
              onDisconnect={setDisconnectTarget}
              googleEnabled={googleEnabled}
              itApprovalUrl={itApprovalUrl}
              googleClientId={googleClientId}
            />
          ) : null}
          {shownWeek && !blocked ? (
            <AccountBanners
              accounts={accounts}
              results={shownWeek.accounts}
              hidden={shownHidden}
              onRetry={() => setRefresh((n) => n + 1)}
            />
          ) : null}
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
                  events={visibleEvents}
                  today={shownWeek.today}
                  tags={tags}
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
        </div>
        {/* Beside every calendar state: Foundry tasks don't wait on Microsoft.
            A new connection state or address set (after Disconnect) reads the to-dos afresh. */}
        <TodoPanel key={`${paneState}:${accounts.map((a) => a.id).join(",")}`} userId={userId} households={households} accounts={accounts} />
      </div>

      <DialogShell
        open={disconnectTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDisconnectTarget(null);
        }}
        title={`Disconnect ${disconnectTarget?.email ?? ""}?`}
        size="sm"
        destructiveAction={{ label: "Disconnect", onClick: disconnectAccount, loading: disconnecting }}
      >
        <p className="text-[14px] text-ink-2">
          Its calendar and to-dos leave Workspace. You can connect it again any time.
        </p>
      </DialogShell>

      {editor?.mode === "create" ? (
        <EventEditorDialog
          mode="create"
          accounts={pickable}
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
          provider={editor.event.provider}
          calendar={tags?.get(editor.event.connectionId)?.email}
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
