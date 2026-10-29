"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from "react";
import { z } from "zod";
import DialogShell from "@/components/dialog-shell";
import { checkboxClassName, fieldLabelClassName, inputClassName } from "@/components/forms/input-styles";
import { ExternalLinkIcon, XIcon } from "@/components/icons";
import type { AttendeeSuggestion, WallClock } from "@/lib/workspace/types";
import { addDays, daysBetween, minutesOfTime, monthDay, timeOf, toWallClock } from "@/lib/workspace/week";

/** What Save hands back — exactly `POST /api/workspace/events`'s body. */
export type EventDraft = {
  subject: string;
  start: WallClock;
  end: WallClock;
  attendees: string[];
  teams: boolean;
};

const FORM_ID = "workspace-event-editor";
const MAX_ATTENDEES = 50; // createEventSchema's cap
const SUGGEST_DELAY_MS = 200;
const BAD_TIMES = "End time must be after the start time.";
const CONFIRM_CANCEL = "Cancel this meeting? Everyone invited gets a cancellation from Outlook.";
const SAVE_FAILED = "Couldn't save the meeting. Try again.";
const CANCEL_FAILED = "Couldn't cancel the meeting. Try again.";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

// The same check the route's schema runs, so a chip never fails on save.
const isEmail = (v: string) => z.email().safeParse(v).success;

/** An end time of 00:00 is the end of the day, so it counts as 1440. */
function endMinutes(t: string): number {
  return t === "00:00" ? 1440 : minutesOfTime(t);
}

/**
 * Whole days from the start's date to the day the meeting ends on, with an end
 * at 00:00 counted as the close of the day before. With the end time, it
 * rebuilds the end exactly, so a meeting that runs overnight or for days
 * saves unchanged.
 */
function spanOf(start: WallClock, end: WallClock): number {
  const days = daysBetween(start.slice(0, 10), end.slice(0, 10));
  return end.slice(11, 16) === "00:00" ? Math.max(0, days - 1) : days;
}

const BUTTON =
  "h-9 rounded-[var(--radius-sm)] px-4 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const hasEmail = (list: string[], email: string) => list.some((a) => a.toLowerCase() === email.toLowerCase());

export function EventEditorDialog({
  mode,
  initial,
  onSave,
  onCancelMeeting,
  onClose,
}: {
  mode: "create" | "edit";
  initial: {
    subject: string;
    start: WallClock;
    end: WallClock;
    attendees: string[];
    teamsUrl: string | null;
  };
  /** Rejects to keep the dialog open with an error; the caller closes it on success. */
  onSave: (input: EventDraft) => Promise<void>;
  onCancelMeeting?: () => Promise<void>;
  onClose: () => void;
}): ReactElement {
  const ids = useId();
  const [subject, setSubject] = useState(initial.subject);
  // One date for both times; the times are read off the wall clocks, never through `Date`.
  const [date, setDate] = useState(initial.start.slice(0, 10));
  const [startTime, setStartTime] = useState(initial.start.slice(11, 16));
  const [endTime, setEndTime] = useState(initial.end.slice(11, 16));
  // The end falls this many days after the date; editing the times never shortens a multi-day meeting.
  const [span, setSpan] = useState(() => spanOf(initial.start, initial.end));
  const [attendees, setAttendees] = useState(initial.attendees);
  const [typed, setTyped] = useState("");
  const [teams, setTeams] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete = DATE_RE.test(date) && TIME_RE.test(startTime) && TIME_RE.test(endTime);
  // Minutes past the date's midnight.
  const endAt = span * 1440 + endMinutes(endTime);
  const badTimes = complete && endAt <= minutesOfTime(startTime);
  const creating = mode === "create";
  const canSave = complete && !badTimes && (!creating || subject.trim() !== "") && !busy;

  function changeStart(next: string) {
    // Moving the start keeps the meeting's length, past midnight if it has to.
    if (TIME_RE.test(next) && TIME_RE.test(startTime) && TIME_RE.test(endTime) && !badTimes) {
      const end = minutesOfTime(next) + endAt - minutesOfTime(startTime);
      const days = Math.floor((end - 1) / 1440);
      setSpan(days);
      setEndTime(timeOf(end - days * 1440));
    }
    setStartTime(next);
  }

  // The confirmation takes focus, so a second Enter or click can't land on the
  // button that asked; backing out returns focus to the form.
  const keepRef = useRef<HTMLButtonElement>(null);
  const startRef = useRef<HTMLInputElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (confirming) keepRef.current?.focus();
    else if (wasConfirming.current) startRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    // An address typed but not yet turned into a chip still gets the invite.
    const pending = typed.trim();
    const invite =
      creating && isEmail(pending) && !hasEmail(attendees, pending) && attendees.length < MAX_ATTENDEES
        ? [...attendees, pending]
        : attendees;
    setBusy(true);
    setError(null);
    try {
      await onSave({
        subject: subject.trim(),
        start: `${date}T${startTime}`,
        end: toWallClock(date, endAt),
        attendees: invite,
        teams: creating && teams,
      });
    } catch {
      setError(SAVE_FAILED);
    } finally {
      setBusy(false);
    }
  }

  async function cancelMeeting() {
    if (!onCancelMeeting) return;
    setBusy(true);
    setError(null);
    try {
      await onCancelMeeting();
    } catch {
      setError(CANCEL_FAILED);
    } finally {
      setBusy(false);
    }
  }

  const errorLine = error ? (
    <p role="alert" className="text-[13px] text-crit">
      {error}
    </p>
  ) : null;

  if (confirming) {
    // Its own buttons, in the body and away from the footer's "Cancel meeting",
    // so they are new elements in a new place.
    return (
      <DialogShell open onOpenChange={(open) => !open && onClose()} title="Edit event" size="sm">
        <div className="flex flex-col gap-4">
          <p role="alert" className="text-[14px] text-ink-2">
            {CONFIRM_CANCEL}
          </p>
          {errorLine}
          <div className="flex justify-end gap-2">
            <button
              ref={keepRef}
              type="button"
              disabled={busy}
              className={`${BUTTON} border border-transparent text-ink-2 hover:border-hair hover:bg-card-hover hover:text-ink`}
              onClick={() => setConfirming(false)}
            >
              Keep meeting
            </button>
            <button
              type="button"
              disabled={busy}
              className={`${BUTTON} border border-crit/40 text-crit hover:bg-card-hover`}
              onClick={cancelMeeting}
            >
              {busy ? "Cancelling…" : "Cancel meeting"}
            </button>
          </div>
        </div>
      </DialogShell>
    );
  }

  const field = (name: string) => `${ids}-${name}`;
  const timeInput = `${inputClassName} tabular`;

  return (
    <DialogShell
      open
      onOpenChange={(open) => !open && onClose()}
      title={creating ? "New event" : "Edit event"}
      size="sm"
      primaryAction={{
        label: "Save",
        form: FORM_ID,
        disabled: !canSave,
        loading: busy,
      }}
      secondaryAction={creating ? undefined : { label: "Close", onClick: onClose }}
      destructiveAction={
        !creating && onCancelMeeting
          ? {
              label: "Cancel meeting",
              onClick: () => setConfirming(true),
              disabled: busy,
            }
          : undefined
      }
    >
      <form id={FORM_ID} noValidate onSubmit={submit} className="flex flex-col gap-4">
        {creating ? (
          <div>
            <label htmlFor={field("subject")} className={fieldLabelClassName}>
              Subject
            </label>
            <input
              id={field("subject")}
              data-autofocus
              className={inputClassName}
              value={subject}
              maxLength={255}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
        ) : (
          <div>
            <p className={fieldLabelClassName}>Subject</p>
            <p className="text-[14px] text-ink">{initial.subject || "(No title)"}</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <label htmlFor={field("date")} className={fieldLabelClassName}>
              Date
            </label>
            <input
              id={field("date")}
              type="date"
              className={timeInput}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor={field("start")} className={fieldLabelClassName}>
              Start
            </label>
            <input
              ref={startRef}
              id={field("start")}
              type="time"
              step={900}
              className={timeInput}
              value={startTime}
              onChange={(e) => changeStart(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor={field("end")} className={fieldLabelClassName}>
              End
            </label>
            <input
              id={field("end")}
              type="time"
              step={900}
              className={timeInput}
              value={endTime}
              aria-invalid={badTimes || undefined}
              aria-describedby={badTimes ? field("times-error") : span > 0 ? field("ends-on") : undefined}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </div>
        </div>
        {badTimes ? (
          <p id={field("times-error")} role="alert" className="-mt-2 text-[13px] text-crit">
            {BAD_TIMES}
          </p>
        ) : complete && span > 0 ? (
          <p id={field("ends-on")} className="-mt-2 text-[13px] text-ink-3">
            Ends <span className="tabular">{monthDay(addDays(date, span))}</span>
          </p>
        ) : null}

        {creating ? (
          <AttendeePicker
            inputId={field("attendees")}
            attendees={attendees}
            onAttendees={setAttendees}
            typed={typed}
            onTyped={setTyped}
          />
        ) : attendees.length > 0 ? (
          <div>
            <p className={fieldLabelClassName}>Attendees</p>
            <AttendeeChips attendees={attendees} />
          </div>
        ) : null}

        {creating ? (
          <label className="flex items-center gap-2 text-[14px] text-ink-2">
            <input
              type="checkbox"
              className={checkboxClassName}
              checked={teams}
              onChange={(e) => setTeams(e.target.checked)}
            />
            Add a Teams link
          </label>
        ) : initial.teamsUrl?.startsWith("https://") ? (
          <a
            href={initial.teamsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 self-start text-[14px] text-ink-2 hover:text-ink hover:underline"
          >
            Join the Teams meeting
            <ExternalLinkIcon width={13} height={13} aria-hidden="true" />
          </a>
        ) : null}

        {errorLine}
      </form>
    </DialogShell>
  );
}

function AttendeeChips({
  attendees,
  onRemove,
}: {
  attendees: string[];
  onRemove?: (email: string) => void;
}): ReactElement {
  return (
    <ul aria-label="Invited" className="flex flex-wrap gap-1.5">
      {attendees.map((email) => (
        <li
          key={email}
          className="inline-flex min-w-0 items-center gap-1 rounded-full border border-hair-2 bg-card-2 py-0.5 pl-2.5 pr-1.5 text-[12px] text-ink-2"
        >
          <span className="truncate">{email}</span>
          {onRemove ? (
            <button
              type="button"
              aria-label={`Remove ${email}`}
              className="rounded-full p-0.5 text-ink-3 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              onClick={() => onRemove(email)}
            >
              <XIcon width={12} height={12} aria-hidden="true" />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Attendee chips plus a type-ahead: after a 200 ms pause on two or more
 * characters it asks for matching CRM contacts and teammates; Enter adds a
 * typed address when it's an email. Case-insensitive dedupe, 50 at most.
 */
function AttendeePicker({
  inputId,
  attendees,
  onAttendees,
  typed,
  onTyped,
}: {
  inputId: string;
  attendees: string[];
  onAttendees: (next: string[]) => void;
  typed: string;
  onTyped: (next: string) => void;
}): ReactElement {
  const query = typed.trim();
  // Keyed by the query they answer, so a stale answer never shows.
  const [found, setFound] = useState<{ query: string; list: AttendeeSuggestion[] } | null>(null);
  useEffect(() => {
    if (query.length < 2) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/workspace/attendee-suggestions?q=${encodeURIComponent(query)}`, { signal: ctrl.signal })
        .then((res) => (res.ok ? (res.json() as Promise<{ suggestions?: unknown }>) : null))
        .then((body) => {
          const list = Array.isArray(body?.suggestions) ? (body.suggestions as AttendeeSuggestion[]) : [];
          if (!ctrl.signal.aborted) setFound({ query, list });
        })
        .catch(() => {
          // No suggestions; typing an address still works.
        });
    }, SUGGEST_DELAY_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  const full = attendees.length >= MAX_ATTENDEES;
  const suggestions =
    found && found.query === query
      ? found.list.filter((s) => !hasEmail(attendees, s.email))
      : [];

  function add(email: string) {
    if (!full && !hasEmail(attendees, email)) onAttendees([...attendees, email]);
    onTyped("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault(); // Enter here adds a chip; it never submits the form
    if (isEmail(query)) add(query);
  }

  return (
    <div>
      <label htmlFor={inputId} className={fieldLabelClassName}>
        Attendees
      </label>
      <div className="flex flex-col gap-2">
        {attendees.length > 0 ? (
          <AttendeeChips
            attendees={attendees}
            onRemove={(email) => onAttendees(attendees.filter((a) => a !== email))}
          />
        ) : null}
        <input
          id={inputId}
          type="text"
          inputMode="email"
          autoComplete="off"
          placeholder={full ? "50 attendees is the most a meeting can have" : "Name or email"}
          disabled={full}
          className={inputClassName}
          value={typed}
          onChange={(e) => onTyped(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {suggestions.length > 0 ? (
          <ul
            aria-label="Suggested attendees"
            className="flex flex-col rounded-[var(--radius-sm)] border border-hair bg-card-2"
          >
            {suggestions.map((s) => (
              <li key={s.email} className="border-t border-hair first:border-t-0">
                <button
                  type="button"
                  className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-card-hover focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                  onClick={() => add(s.email)}
                >
                  <span className="truncate text-ink">{s.name}</span>{" "}
                  <span className="min-w-0 truncate text-ink-3">{s.email}</span>{" "}
                  <span className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
                    {s.kind === "client" ? "Client" : "Team"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
