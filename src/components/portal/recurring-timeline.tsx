import type { ReactElement } from "react";

function monthAbbr(ym: string): string {
  return new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
}

export function RecurringTimeline({
  timeline,
  upcoming,
}: {
  timeline: { month: string; paid: boolean }[];
  upcoming: string | null;
}): ReactElement {
  const first = timeline[0]?.month;
  const last = timeline.at(-1)?.month;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        {timeline.map((t) => (
          <div key={t.month} className="flex flex-1 items-center gap-1">
            <span
              data-dot
              title={`${t.month}: ${t.paid ? "paid" : "no payment"}`}
              className={
                t.paid
                  ? "h-2.5 w-2.5 shrink-0 rounded-full bg-accent"
                  : "h-2.5 w-2.5 shrink-0 rounded-full bg-card-2 ring-1 ring-inset ring-hair-2"
              }
            />
            <span className="flex-1 border-t border-hair" />
          </div>
        ))}
        <span
          data-dot
          title={upcoming ? `next: ${upcoming}` : "upcoming"}
          className="h-2.5 w-2.5 shrink-0 rounded-full border border-dashed border-ink-3"
        />
      </div>
      <div className="flex justify-between text-[9px] uppercase tracking-wide text-ink-3">
        <span>{first ? monthAbbr(first) : ""}</span>
        <span>{last ? monthAbbr(last) : ""}</span>
      </div>
    </div>
  );
}
