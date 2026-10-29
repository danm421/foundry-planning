// src/lib/workspace/week.ts
import type { WallClock, WorkspaceEvent } from "./types";

/**
 * Pure week-calendar math. Dates are `YYYY-MM-DD` strings and times are
 * `WallClock` strings in the mailbox time zone. Nothing here parses a wall
 * clock into a `Date`: the browser would read it in ITS zone and shift every
 * meeting across a DST change. Day arithmetic goes through `Date.UTC`, which
 * has no DST, and minutes are read straight off the string.
 */

const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A meeting shorter than this still renders this tall, so overlap is judged on
 * the drawn height: two 5-minute meetings 5 minutes apart sit side by side
 * instead of one covering the other.
 */
export const MIN_EVENT_MINUTES = 20;

function toUtcMs(date: string): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function addDays(date: string, n: number): string {
  return fromUtcMs(toUtcMs(date) + n * DAY_MS);
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

/** The Monday of the week `date` falls in (weeks run Monday–Sunday). */
export function mondayOf(date: string): string {
  const weekday = new Date(toUtcMs(date)).getUTCDay(); // 0 = Sunday
  return addDays(date, -((weekday + 6) % 7));
}

/** Minutes past midnight, read off the string. */
export function minutesOf(w: WallClock): number {
  return Number(w.slice(11, 13)) * 60 + Number(w.slice(14, 16));
}

export function snapMinutes(m: number, step = 15): number {
  return Math.round(m / step) * step;
}

/** `minutes` past `date`'s midnight as a wall clock; past 24:00 (or before 00:00) rolls the day. */
export function toWallClock(date: string, minutes: number): WallClock {
  const days = Math.floor(minutes / 1440);
  const m = minutes - days * 1440;
  return `${days ? addDays(date, days) : date}T${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

function shift(w: WallClock, minutes: number): WallClock {
  return toWallClock(w.slice(0, 10), minutesOf(w) + minutes);
}

/** A resize never leaves a meeting shorter than this. */
const MIN_RESIZE_MINUTES = 15;

/**
 * Where a drag drops a meeting. `move` shifts both ends by whole days plus the
 * snapped minutes, keeping the piece drawn in the grabbed column (`topMin` to
 * `endMin`) inside its day; `resize` moves only the end, up to that day's
 * midnight and never closer than 15 minutes to the start. Null when the drop
 * is where the meeting already is.
 */
export function dropTarget(
  event: { start: WallClock; end: WallClock },
  piece: { topMin: number; endMin: number },
  drag: { mode: "move" | "resize"; days: number; minutes: number },
): { start: WallClock; end: WallClock } | null {
  const snapped = snapMinutes(drag.minutes);
  if (drag.mode === "move") {
    const minutes = Math.min(Math.max(snapped, -piece.topMin), 1440 - piece.endMin);
    if (drag.days === 0 && minutes === 0) return null;
    const by = drag.days * 1440 + minutes;
    return { start: shift(event.start, by), end: shift(event.end, by) };
  }
  const moved = shift(event.end, Math.min(snapped, 1440 - piece.endMin));
  const shortest = shift(event.start, MIN_RESIZE_MINUTES);
  // Fixed-width strings compare in time order.
  const end = moved < shortest ? shortest : moved;
  return end === event.end ? null : { start: event.start, end };
}

/**
 * A new meeting's default slot, 30 minutes long: today's next full hour when
 * today is one of the shown days, otherwise the shown Monday at 9:00.
 */
export function newEventSlot(
  weekStart: string,
  days: number,
  today: string,
  nowMinutes: number,
): { start: WallClock; end: WallClock } {
  const shown = today >= weekStart && today < addDays(weekStart, days);
  const start = shown ? toWallClock(today, (Math.floor(nowMinutes / 60) + 1) * 60) : `${weekStart}T09:00`;
  return { start, end: shift(start, 30) };
}

/** Today in the browser's zone. The mailbox zone's "today" isn't derivable
 *  from Outlook's Windows zone names, so this is the accepted stand-in. The one
 *  thing here that reads the clock. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** `Oct 28`. */
export function monthDay(date: string): string {
  return `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
}

/** `Oct 26 – Oct 30, 2026`; the year repeats only when the week spans two. */
export function formatWeekRange(weekStart: string, days: number): string {
  const last = addDays(weekStart, days - 1);
  const y1 = weekStart.slice(0, 4);
  const y2 = last.slice(0, 4);
  return y1 === y2
    ? `${monthDay(weekStart)} – ${monthDay(last)}, ${y2}`
    : `${monthDay(weekStart)}, ${y1} – ${monthDay(last)}, ${y2}`;
}

export type PositionedEvent<E extends WorkspaceEvent = WorkspaceEvent> = {
  event: E;
  topMin: number;
  endMin: number;
  column: number;
  columns: number;
};

/**
 * One day's column of the week: all-day events (and timed ones that cover the
 * whole day) for the all-day strip, and timed events clipped to the day and
 * given side-by-side columns where they overlap.
 */
export function layoutDay<E extends WorkspaceEvent>(
  events: E[],
  date: string,
): { allDay: E[]; timed: PositionedEvent<E>[] } {
  const dayStart = `${date}T00:00`;
  const dayEnd = `${addDays(date, 1)}T00:00`;
  const allDay: E[] = [];
  const clipped: { event: E; topMin: number; endMin: number }[] = [];

  for (const event of events) {
    if (event.isAllDay) {
      // Graph's all-day end is the exclusive next midnight.
      const first = event.start.slice(0, 10);
      const end = event.end.slice(0, 10);
      if (first <= date && (date < end || first === date)) allDay.push(event);
      continue;
    }
    // Fixed-width strings compare in time order.
    const touches =
      event.start < dayEnd && (event.end > dayStart || (event.start === event.end && event.start >= dayStart));
    if (!touches) continue;
    const topMin = event.start < dayStart ? 0 : minutesOf(event.start);
    const endMin = event.end >= dayEnd ? 1440 : minutesOf(event.end);
    if (topMin === 0 && endMin === 1440) allDay.push(event);
    else clipped.push({ event, topMin, endMin });
  }

  // Earliest first; at a tie the longer meeting takes the left column.
  clipped.sort((a, b) => a.topMin - b.topMin || b.endMin - a.endMin || a.event.id.localeCompare(b.event.id));

  const timed: PositionedEvent<E>[] = [];
  let cluster: PositionedEvent<E>[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -1;
  const closeCluster = () => {
    for (const p of cluster) p.columns = columnEnds.length;
    cluster = [];
    columnEnds = [];
  };

  for (const c of clipped) {
    const drawnEnd = Math.max(c.endMin, c.topMin + MIN_EVENT_MINUTES);
    if (c.topMin >= clusterEnd) closeCluster();
    let column = columnEnds.findIndex((end) => end <= c.topMin);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(drawnEnd);
    } else {
      columnEnds[column] = drawnEnd;
    }
    const placed = { ...c, column, columns: 1 };
    cluster.push(placed);
    timed.push(placed);
    clusterEnd = Math.max(clusterEnd, drawnEnd);
  }
  closeCluster();

  return { allDay, timed };
}
