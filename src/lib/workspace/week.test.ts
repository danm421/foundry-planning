import { describe, it, expect } from "vitest";
import type { WorkspaceEvent } from "./types";
import {
  addDays,
  formatWeekRange,
  layoutDay,
  minutesOf,
  mondayOf,
  snapMinutes,
  toWallClock,
} from "./week";

function ev(id: string, start: string, end: string, isAllDay = false): WorkspaceEvent {
  return {
    id,
    subject: id,
    start,
    end,
    isAllDay,
    isOrganizer: true,
    isCancelled: false,
    type: "singleInstance",
    attendees: [],
    teamsUrl: null,
    webLink: `https://outlook.office.com/${id}`,
  };
}

describe("week date math", () => {
  it("mondayOf finds the Monday of a mid-week day and of a Sunday", () => {
    expect(mondayOf("2026-10-28")).toBe("2026-10-26");
    expect(mondayOf("2026-11-01")).toBe("2026-10-26");
    expect(mondayOf("2026-10-26")).toBe("2026-10-26");
  });

  it("addDays crosses a month end", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDays("2026-11-02", -7)).toBe("2026-10-26");
  });

  it("snapMinutes rounds to the nearest 15 by default", () => {
    expect(snapMinutes(607)).toBe(600);
    expect(snapMinutes(608)).toBe(615);
    expect(snapMinutes(608, 30)).toBe(600);
  });

  it("minutesOf and toWallClock read and write the wall clock as written", () => {
    expect(minutesOf("2026-11-02T09:00")).toBe(540);
    expect(toWallClock("2026-11-02", 545)).toBe("2026-11-02T09:05");
  });

  it("formatWeekRange names the shown days, with the year once", () => {
    expect(formatWeekRange("2026-10-26", 5)).toBe("Oct 26 – Oct 30, 2026");
    expect(formatWeekRange("2026-10-26", 7)).toBe("Oct 26 – Nov 1, 2026");
    expect(formatWeekRange("2026-12-28", 7)).toBe("Dec 28, 2026 – Jan 3, 2027");
  });
});

describe("layoutDay", () => {
  it("puts overlapping meetings side by side and a separate one full width", () => {
    const { timed } = layoutDay(
      [
        ev("a", "2026-10-27T10:00", "2026-10-27T11:30"),
        ev("b", "2026-10-27T11:00", "2026-10-27T12:00"),
        ev("c", "2026-10-27T13:00", "2026-10-27T14:00"),
      ],
      "2026-10-27",
    );
    const byId = Object.fromEntries(timed.map((p) => [p.event.id, p]));
    expect(byId.a).toMatchObject({ topMin: 600, endMin: 690, column: 0, columns: 2 });
    expect(byId.b).toMatchObject({ topMin: 660, endMin: 720, column: 1, columns: 2 });
    expect(byId.c).toMatchObject({ topMin: 780, endMin: 840, column: 0, columns: 1 });
  });

  it("reuses a freed column inside one overlap cluster", () => {
    const { timed } = layoutDay(
      [
        ev("long", "2026-10-27T09:00", "2026-10-27T12:00"),
        ev("early", "2026-10-27T09:00", "2026-10-27T10:00"),
        ev("late", "2026-10-27T10:30", "2026-10-27T11:00"),
      ],
      "2026-10-27",
    );
    const byId = Object.fromEntries(timed.map((p) => [p.event.id, p]));
    expect(byId.long.columns).toBe(2);
    expect(byId.early.column).not.toBe(byId.long.column);
    expect(byId.late.column).toBe(byId.early.column);
  });

  it("does not stack back-to-back meetings into columns", () => {
    const { timed } = layoutDay(
      [ev("a", "2026-10-27T10:00", "2026-10-27T11:00"), ev("b", "2026-10-27T11:00", "2026-10-27T12:00")],
      "2026-10-27",
    );
    expect(timed.map((p) => p.columns)).toEqual([1, 1]);
  });

  it("an all-day event lands in the all-day strip on each day it covers", () => {
    const offsite = ev("offsite", "2026-10-27T00:00", "2026-10-29T00:00", true);
    expect(layoutDay([offsite], "2026-10-27")).toEqual({ allDay: [offsite], timed: [] });
    expect(layoutDay([offsite], "2026-10-28").allDay).toEqual([offsite]);
    expect(layoutDay([offsite], "2026-10-29").allDay).toEqual([]);
  });

  it("clips a meeting that crosses midnight to each day it touches", () => {
    const late = ev("late", "2026-10-27T22:00", "2026-10-28T02:00");
    expect(layoutDay([late], "2026-10-27").timed[0]).toMatchObject({ topMin: 1320, endMin: 1440 });
    expect(layoutDay([late], "2026-10-28").timed[0]).toMatchObject({ topMin: 0, endMin: 120 });
    expect(layoutDay([late], "2026-10-29")).toEqual({ allDay: [], timed: [] });
  });

  it("a timed meeting covering a whole day sits in that day's all-day strip", () => {
    const trip = ev("trip", "2026-10-27T15:00", "2026-10-29T10:00");
    expect(layoutDay([trip], "2026-10-28")).toEqual({ allDay: [trip], timed: [] });
    expect(layoutDay([trip], "2026-10-27").timed[0]).toMatchObject({ topMin: 900, endMin: 1440 });
  });

  it("a 9:00 meeting the Monday after the DST change renders at 9:00", () => {
    const { timed } = layoutDay([ev("standup", "2026-11-02T09:00", "2026-11-02T10:00")], "2026-11-02");
    expect(timed[0].topMin).toBe(540);
    expect(timed[0].endMin).toBe(600);
  });
});
