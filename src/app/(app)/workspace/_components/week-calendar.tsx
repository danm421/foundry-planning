"use client";

import { useLayoutEffect, useRef, type ReactElement } from "react";
import Link from "next/link";
import { LockIcon } from "@/components/icons";
import type { HouseholdLink } from "@/lib/workspace/client-links";
import type { WallClock, WorkspaceEvent } from "@/lib/workspace/types";
import { addDays, layoutDay, MIN_EVENT_MINUTES, minutesOf, type PositionedEvent } from "@/lib/workspace/week";

/** One row of `GET /api/workspace/events`. */
export type WeekEvent = WorkspaceEvent & { editable: boolean; household: HouseholdLink | null };

const HOUR_PX = 48;
const PX_PER_MIN = HOUR_PX / 60;
const SCROLL_TO_HOUR = 7;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
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
}: {
  weekStart: string;
  days: 5 | 7;
  events: WeekEvent[];
  /** `YYYY-MM-DD` in the browser's zone — an accepted stand-in for the mailbox's. */
  today: string;
}): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Before first paint, so the week opens on the working day, not midnight.
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = SCROLL_TO_HOUR * HOUR_PX;
  }, []);

  const dates = Array.from({ length: days }, (_, i) => addDays(weekStart, i));
  const laidOut = dates.map((date) => layoutDay(events, date));
  const columns = { gridTemplateColumns: `44px repeat(${days}, minmax(0, 1fr))` };

  return (
    <section aria-label="Week calendar">
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
                  className={`flex items-center justify-center gap-1.5 py-2 text-[11px] ${isToday ? "text-ink" : "text-ink-3"}`}
                >
                  <span className="uppercase tracking-[0.06em]">{WEEKDAYS[i]}</span>
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

        <div className="relative grid" style={{ ...columns, height: 24 * HOUR_PX }}>
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
              {timed.map((p) => (
                <TimedEvent key={p.event.id} placed={p} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TimedEvent({ placed }: { placed: PositionedEvent<WeekEvent> }): ReactElement {
  const { event: e, topMin, endMin, column, columns } = placed;
  const width = 100 / columns;
  return (
    <div
      title={e.editable ? undefined : LOCKED_TITLE}
      className={`absolute overflow-hidden rounded-[var(--radius-sm)] border-l-[3px] px-1.5 py-1 text-[11px] leading-[1.3] ${tone(e)}`}
      style={{
        top: topMin * PX_PER_MIN,
        height: Math.max(endMin - topMin, MIN_EVENT_MINUTES) * PX_PER_MIN - 2,
        left: `calc(${column * width}% + 2px)`,
        width: `calc(${width}% - 4px)`,
      }}
    >
      <div className="flex min-w-0 items-center gap-1">
        <EventTitle event={e} />
      </div>
      <div className="tabular text-ink-3">
        {clock(e.start)} – {clock(e.end)}
      </div>
      {e.household ? <HouseholdName household={e.household} /> : null}
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
    >
      {household.householdName}
    </Link>
  );
}
