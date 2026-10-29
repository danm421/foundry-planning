// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { HouseholdLink } from "@/lib/workspace/client-links";
import type { WorkspaceEvent } from "@/lib/workspace/types";
import { WeekCalendar } from "../week-calendar";

type Row = WorkspaceEvent & { editable: boolean; household: HouseholdLink | null };

function row(over: Partial<Row> & Pick<Row, "id" | "start" | "end">): Row {
  return {
    subject: over.id,
    isAllDay: false,
    isOrganizer: true,
    isCancelled: false,
    type: "singleInstance",
    attendees: [],
    teamsUrl: null,
    webLink: `https://outlook.office.com/calendar/item/${over.id}`,
    editable: true,
    household: null,
    ...over,
  };
}

const WEEKDAY = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/;

describe("WeekCalendar", () => {
  it("renders five day headers for a Monday–Friday week", () => {
    render(<WeekCalendar weekStart="2026-10-26" days={5} events={[]} today="2026-10-28" />);
    expect(screen.getAllByText(WEEKDAY).map((el) => el.textContent)).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
    ]);
  });

  it("renders seven day headers when weekends are shown", () => {
    render(<WeekCalendar weekStart="2026-10-26" days={7} events={[]} today="2026-10-28" />);
    expect(screen.getAllByText(WEEKDAY)).toHaveLength(7);
  });

  it("a client-linked meeting names its household and links to it", () => {
    render(
      <WeekCalendar
        weekStart="2026-10-26"
        days={5}
        today="2026-10-28"
        events={[
          row({
            id: "review",
            subject: "Annual review",
            start: "2026-10-27T10:00",
            end: "2026-10-27T11:30",
            household: { householdId: "hh-1", householdName: "Hartley" },
          }),
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "Hartley" })).toHaveAttribute(
      "href",
      "/crm/households/hh-1",
    );
  });

  it("a meeting someone else organized carries the lock and the Outlook hint", () => {
    render(
      <WeekCalendar
        weekStart="2026-10-26"
        days={5}
        today="2026-10-28"
        events={[
          row({
            id: "training",
            subject: "Compliance training",
            start: "2026-10-30T09:00",
            end: "2026-10-30T10:30",
            isOrganizer: false,
            editable: false,
          }),
        ]}
      />,
    );
    const lock = screen.getByRole("img", { name: "Organized by someone else" });
    expect(lock.closest("[title]")).toHaveAttribute(
      "title",
      "You didn't organize this meeting — open it in Outlook to change it.",
    );
  });

  it("a meeting the advisor organized has no lock", () => {
    render(
      <WeekCalendar
        weekStart="2026-10-26"
        days={5}
        today="2026-10-28"
        events={[row({ id: "huddle", start: "2026-10-26T09:00", end: "2026-10-26T09:30" })]}
      />,
    );
    expect(screen.getByText("huddle")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Organized by someone else" })).toBeNull();
  });

  it("an all-day event renders in the all-day strip, not the hour grid", () => {
    render(
      <WeekCalendar
        weekStart="2026-10-26"
        days={5}
        today="2026-10-28"
        events={[
          row({
            id: "offsite",
            subject: "Team offsite",
            start: "2026-10-27T00:00",
            end: "2026-10-28T00:00",
            isAllDay: true,
          }),
        ]}
      />,
    );
    const strip = screen.getByRole("group", { name: "All-day events" });
    expect(within(strip).getByText("Team offsite")).toBeInTheDocument();
  });
});
