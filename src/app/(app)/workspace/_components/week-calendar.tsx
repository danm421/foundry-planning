"use client";

import { useLayoutEffect, useRef, type MouseEvent, type PointerEvent, type ReactElement } from "react";
import Link from "next/link";
import { LockIcon } from "@/components/icons";
import type { HouseholdLink } from "@/lib/workspace/client-links";
import type { WallClock, WorkspaceEvent } from "@/lib/workspace/types";
import {
  addDays,
  layoutDay,
  MIN_EVENT_MINUTES,
  minutesOf,
  toWallClock,
  type PositionedEvent,
} from "@/lib/workspace/week";
import { useEventDrag, type DragMode } from "./use-event-drag";

/** One row of `GET /api/workspace/events`. */
export type WeekEvent = WorkspaceEvent & { editable: boolean; household: HouseholdLink | null };

const HOUR_PX = 48;
const PX_PER_MIN = HOUR_PX / 60;
const GUTTER_PX = 44;
const SCROLL_TO_HOUR = 7;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/**
 * "Mon 26" needs ~52px a day; below that ("WED 28THU 29" on a phone) the
 * header drops to one letter over the date. Read off the calendar's own width
 * (a container query): 44px of hours plus 5 × 52 = 304px, or 7 × 52 = 408px.
 */
const DAY_HEADER = {
  5: {
    cell: "@min-[304px]:flex-row @min-[304px]:gap-1.5",
    full: "hidden @min-[304px]:inline",
    short: "@min-[304px]:hidden",
  },
  7: {
    cell: "@min-[408px]:flex-row @min-[408px]:gap-1.5",
    full: "hidden @min-[408px]:inline",
    short: "@min-[408px]:hidden",
  },
} as const;
/** Boxes shorter than this (under ~40 minutes) show only their subject. */
const COMPACT_PX = 30;
const LOCKED_TITLE = "You didn't organize this meeting — open it in Outlook to change it.";

function hourLabel(h: number): string {
  return `${h % 12 || 12}${h < 12 ? "a" : "p"}`;
}

/** `9:00`, read off the wall clock (never through `Date`). */
function clock(w: WallClock): string {
  const m = minutesOf(w);
  return `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, "0")}`;
}

/** Client-linked meetings are green, the rest blue. */
function tone(e: WeekEvent): string {
  return e.household ? "border-data-green bg-data-green/20" : "border-data-blue bg-data-blue/20";
}

export function WeekCalendar({
  weekStart,
  days,
  events,
  today,
  onMove,
  onOpen,
}: {
  weekStart: string;
  days: 5 | 7;
  events: WeekEvent[];
  /** `YYYY-MM-DD` in the browser's zone — an accepted stand-in for the mailbox's. */
  today: string;
  /** A meeting dragged or resized to new times (only `editable` ones can be). */
  onMove: (eventId: string, start: WallClock, end: WallClock) => Promise<void>;
  /** A meeting the advisor can edit was clicked, or Enter was pressed on it. */
  onOpen: (eventId: string) => void;
}): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Before first paint, so the week opens on the working day, not midnight.
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = SCROLL_TO_HOUR * HOUR_PX;
  }, []);

  const { gridRef, preview, begin, swallowDropClick, captureProps } = useEventDrag({
    days,
    gutterPx: GUTTER_PX,
    pxPerMin: PX_PER_MIN,
    onMove,
  });
  // Mid-drag, the meeting is laid out at the times it would drop at.
  const shown = preview
    ? events.map((e) => (e.id === preview.id ? { ...e, start: preview.start, end: preview.end } : e))
    : events;

  const dates = Array.from({ length: days }, (_, i) => addDays(weekStart, i));
  const laidOut = dates.map((date) => layoutDay(shown, date));
  const columns = { gridTemplateColumns: `${GUTTER_PX}px repeat(${days}, minmax(0, 1fr))` };

  return (
    // Holds pointer capture during a drag, so the drag outlives the meeting's re-render.
    <section aria-label="Week calendar" className="@container" {...captureProps}>
      <div
        ref={scrollRef}
        className="relative h-[min(720px,calc(100dvh-16rem))] min-h-[360px] overflow-y-auto"
      >
        {/* Day headers and the all-day strip stick above the hours, inside the
            same scroller, so their columns line up with the grid's. */}
        <div className="sticky top-0 z-10 border-b border-hair bg-card">
          <div className="grid" style={columns}>
            <div />
            {dates.map((date, i) => {
              const isToday = date === today;
              return (
                <div
                  key={date}
                  aria-current={isToday ? "date" : undefined}
                  className={`flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] ${DAY_HEADER[days].cell} ${isToday ? "text-ink" : "text-ink-3"}`}
                >
                  <span className={`uppercase tracking-[0.06em] ${DAY_HEADER[days].full}`}>{WEEKDAYS[i]}</span>
                  <span className={`uppercase ${DAY_HEADER[days].short}`}>{WEEKDAYS[i][0]}</span>
                  <span
                    className={`tabular ${isToday ? "rounded-full bg-accent px-1.5 font-semibold text-accent-on" : ""}`}
                  >
                    {Number(date.slice(8, 10))}
                  </span>
                </div>
              );
            })}
          </div>
          <div role="group" aria-label="All-day events" className="grid border-t border-hair" style={columns}>
            <div className="py-1 pr-1.5 text-right font-mono text-[9px] uppercase leading-[18px] tracking-[0.08em] text-ink-4">
              All day
            </div>
            {laidOut.map(({ allDay }, i) => (
              <div key={dates[i]} className="flex min-w-0 flex-col gap-0.5 border-l border-hair p-0.5">
                {allDay.map((e) => (
                  <div
                    key={e.id}
                    title={e.editable ? undefined : LOCKED_TITLE}
                    className={`flex min-w-0 items-center gap-1 rounded-[var(--radius-sm)] border-l-[3px] px-1.5 py-0.5 text-[11px] leading-[1.3] ${tone(e)}`}
                  >
                    <EventTitle event={e} />
                    {e.household ? <HouseholdName household={e.household} /> : null}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div ref={gridRef} className="relative grid" style={{ ...columns, height: 24 * HOUR_PX }}>
          {/* Hour lines span every column; the labels sit in the first. */}
          <div aria-hidden className="col-span-full row-start-1">
            {HOURS.map((h) => (
              <div key={h} className="border-t border-hair first:border-t-0" style={{ height: HOUR_PX }} />
            ))}
          </div>
          <div aria-hidden className="col-start-1 row-start-1">
            {HOURS.map((h) => (
              <div key={h} className="pr-1.5 pt-0.5 text-right" style={{ height: HOUR_PX }}>
                <span className="tabular text-[10px] text-ink-4">{hourLabel(h)}</span>
              </div>
            ))}
          </div>
          {laidOut.map(({ timed }, i) => (
            <div
              key={dates[i]}
              className="relative row-start-1 border-l border-hair"
              style={{ gridColumnStart: i + 2 }}
            >
              {timed.map((p) =>
                p.event.editable ? (
                  <EditableEvent
                    key={p.event.id}
                    placed={p}
                    date={dates[i]}
                    dragging={preview?.id === p.event.id}
                    onPress={(e, mode) =>
                      begin(e, mode, {
                        id: p.event.id,
                        event: p.event,
                        piece: { topMin: p.topMin, endMin: p.endMin },
                      })
                    }
                    onClickCapture={swallowDropClick}
                    onOpen={() => onOpen(p.event.id)}
                  />
                ) : (
                  <LockedEvent key={p.event.id} placed={p} />
                ),
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const EVENT_BOX =
  "absolute overflow-hidden rounded-[var(--radius-sm)] border-l-[3px] px-1.5 text-[11px] leading-[1.3]";

/**
 * Where a timed meeting's piece sits in its day column, drawn no shorter than
 * `MIN_EVENT_MINUTES` and never past midnight. Its lines stack top down, the
 * subject first, and the box clips whatever doesn't fit; a `compact` box has
 * room for the subject alone.
 */
function boxLayout({ topMin, endMin, column, columns }: PositionedEvent<WeekEvent>) {
  const width = 100 / columns;
  const height = Math.min(Math.max(endMin - topMin, MIN_EVENT_MINUTES), 1440 - topMin) * PX_PER_MIN - 2;
  const compact = height < COMPACT_PX;
  return {
    compact,
    className: `${EVENT_BOX} ${compact ? "py-0.5" : "py-1"}`,
    style: {
      top: topMin * PX_PER_MIN,
      height,
      left: `calc(${column * width}% + 2px)`,
      width: `calc(${width}% - 4px)`,
    },
  };
}

/** The meeting's times: drawn when there's room, always read out. */
function TimeLine({ event: e, compact }: { event: WeekEvent; compact: boolean }): ReactElement {
  return (
    <span className={compact ? "sr-only" : "tabular block truncate text-ink-3"}>
      {clock(e.start)} – {clock(e.end)}
    </span>
  );
}

/** Someone else's meeting: read-only, with the lock and a link to Outlook. */
function LockedEvent({ placed }: { placed: PositionedEvent<WeekEvent> }): ReactElement {
  const e = placed.event;
  const box = boxLayout(placed);
  return (
    <div title={LOCKED_TITLE} className={`${box.className} ${tone(e)}`} style={box.style}>
      <div className="flex min-w-0 items-center gap-1">
        <EventTitle event={e} />
      </div>
      <TimeLine event={e} compact={box.compact} />
      {e.household && !box.compact ? <HouseholdName household={e.household} /> : null}
    </div>
  );
}

/**
 * A meeting the advisor organizes, draggable to new times, with a bottom edge
 * that resizes it. A click anywhere on it that isn't a drag opens the editor;
 * the button inside is the keyboard path (Enter), whose click bubbles up to
 * the same handler. The household link sits beside the button, never inside
 * it, and leaves the click to itself.
 */
function EditableEvent({
  placed,
  date,
  dragging,
  onPress,
  onClickCapture,
  onOpen,
}: {
  placed: PositionedEvent<WeekEvent>;
  date: string;
  dragging: boolean;
  onPress: (e: PointerEvent, mode: DragMode) => void;
  onClickCapture: (e: MouseEvent) => void;
  onOpen: () => void;
}): ReactElement {
  const e = placed.event;
  const box = boxLayout(placed);
  // Only the piece holding the real end resizes; a day the meeting merely runs through doesn't.
  const endsHere = e.end <= toWallClock(date, 1440);
  return (
    <div
      // No `touch-none`: a swipe that starts on a meeting scrolls the week (touch never drags).
      className={`${box.className} ${tone(e)} cursor-pointer select-none has-[button:focus-visible]:outline has-[button:focus-visible]:outline-2 has-[button:focus-visible]:outline-accent ${dragging ? "z-20 outline outline-1 outline-ink-3" : ""}`}
      style={box.style}
      onPointerDown={(ev) => onPress(ev, "move")}
      onClickCapture={onClickCapture}
      onClick={onOpen}
      // A link or text inside would otherwise start the browser's own drag.
      onDragStart={(ev) => ev.preventDefault()}
    >
      <button type="button" className="block w-full min-w-0 cursor-pointer text-left focus-visible:outline-none">
        <span className="block truncate font-medium text-ink">{e.subject || "(No title)"}</span>{" "}
        <TimeLine event={e} compact={box.compact} />
      </button>
      {e.household && !box.compact ? <HouseholdName household={e.household} /> : null}
      {endsHere ? (
        <div
          aria-hidden
          data-resize-handle=""
          className={`absolute inset-x-0 bottom-0 cursor-ns-resize ${box.compact ? "h-[3px]" : "h-1.5"}`}
          onPointerDown={(ev) => {
            ev.stopPropagation();
            onPress(ev, "resize");
          }}
        />
      ) : null}
    </div>
  );
}

/** The lock (for someone else's meeting) and the subject, linked to Outlook. */
function EventTitle({ event: e }: { event: WeekEvent }): ReactElement {
  const subject = e.subject || "(No title)";
  return (
    <>
      {e.editable ? null : (
        <LockIcon
          role="img"
          aria-label="Organized by someone else"
          width={11}
          height={11}
          className="shrink-0 text-ink-3"
        />
      )}
      {e.webLink.startsWith("https://") ? (
        <a
          href={e.webLink}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 truncate font-medium text-ink hover:underline"
        >
          {subject}
        </a>
      ) : (
        <span className="min-w-0 truncate font-medium text-ink">{subject}</span>
      )}
    </>
  );
}

function HouseholdName({ household }: { household: HouseholdLink }): ReactElement {
  return (
    <Link
      href={`/crm/households/${household.householdId}`}
      className="block min-w-0 truncate text-ink-2 hover:text-ink hover:underline"
      // Inside a meeting you organize, a click opens the editor; this one is the link's.
      onClick={(ev) => ev.stopPropagation()}
    >
      {household.householdName}
    </Link>
  );
}
