// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

/** The Task 12 handlers; tests that don't exercise them still have to pass them. */
const noop = { onMove: async () => {}, onOpen: () => {} };

describe("WeekCalendar", () => {
  it("renders five day headers for a Monday–Friday week", () => {
    render(
      <WeekCalendar {...noop} weekStart="2026-10-26" days={5} events={[]} today="2026-10-28" />,
    );
    expect(screen.getAllByText(WEEKDAY).map((el) => el.textContent)).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
    ]);
  });

  it("renders seven day headers when weekends are shown", () => {
    render(
      <WeekCalendar {...noop} weekStart="2026-10-26" days={7} events={[]} today="2026-10-28" />,
    );
    expect(screen.getAllByText(WEEKDAY)).toHaveLength(7);
  });

  it("a client-linked meeting names its household and links to it", () => {
    render(
      <WeekCalendar
        {...noop}
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
        {...noop}
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
        {...noop}
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
        {...noop}
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

  it("pressing Enter on a meeting the advisor organized opens it", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(
      <WeekCalendar
        {...noop}
        onOpen={onOpen}
        weekStart="2026-10-26"
        days={5}
        today="2026-10-28"
        events={[
          row({
            id: "huddle",
            subject: "Team huddle",
            start: "2026-10-26T09:00",
            end: "2026-10-26T09:30",
          }),
        ]}
      />,
    );
    screen.getByRole("button", { name: /Team huddle/ }).focus();
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith("huddle");
  });

  it("clicking a meeting the advisor organized opens it", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(
      <WeekCalendar
        {...noop}
        onOpen={onOpen}
        weekStart="2026-10-26"
        days={5}
        today="2026-10-28"
        events={[
          row({
            id: "huddle",
            subject: "Team huddle",
            start: "2026-10-26T09:00",
            end: "2026-10-26T09:30",
          }),
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Team huddle/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith("huddle");
  });

  it("a meeting someone else organized is not a button, and Enter on it opens nothing", () => {
    const onOpen = vi.fn();
    render(
      <WeekCalendar
        {...noop}
        onOpen={onOpen}
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
    expect(screen.queryByRole("button", { name: /Compliance training/ })).toBeNull();
    const block = screen.getByText("Compliance training").closest("[title]") as HTMLElement;
    expect(block).not.toHaveAttribute("tabindex");
    fireEvent.keyDown(block, { key: "Enter" });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("a household link inside an organized meeting stays a link, outside the button", () => {
    render(
      <WeekCalendar
        {...noop}
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
    const button = screen.getByRole("button", { name: /Annual review/ });
    expect(within(button).queryByRole("link")).toBeNull();
    expect(screen.getByRole("link", { name: "Hartley" })).toBeInTheDocument();
  });
});

/**
 * jsdom has no layout, so the grid's box is stubbed: a 44px hour gutter, then
 * five 100px day columns, 48px an hour from the top (0.8px a minute).
 */
describe("WeekCalendar — dragging", () => {
  const COL = 100;
  const x = (col: number) => 44 + col * COL + COL / 2;
  const y = (minutes: number) => minutes * 0.8;
  // Once a drag starts the calendar holds pointer capture, so later events land on it.
  const calendar = () => screen.getByRole("region", { name: "Week calendar" });

  beforeEach(() => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 44 + 5 * COL,
      bottom: 24 * 48,
      width: 44 + 5 * COL,
      height: 24 * 48,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    Element.prototype.setPointerCapture = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderHuddle(handlers: Partial<typeof noop> = {}) {
    render(
      <WeekCalendar
        {...noop}
        {...handlers}
        weekStart="2026-10-26"
        days={5}
        today="2026-10-28"
        events={[row({ id: "huddle", subject: "Team huddle", start: "2026-10-26T09:00", end: "2026-10-26T09:30" })]}
      />,
    );
    return screen.getByRole("button", { name: /Team huddle/ });
  }

  // A press, a move with the button held, and a release, at a day column and a minute of the day.
  const press = (el: Element, col: number, min: number, pointerId = 1) =>
    fireEvent.pointerDown(el, { pointerId, button: 0, buttons: 1, clientX: x(col), clientY: y(min) });
  const moveTo = (el: Element, col: number, min: number, pointerId = 1) =>
    fireEvent.pointerMove(el, { pointerId, buttons: 1, clientX: x(col), clientY: y(min) });
  const release = (col: number, min: number, pointerId = 1) =>
    fireEvent.pointerUp(calendar(), { pointerId, clientX: x(col), clientY: y(min) });

  it("dragging a meeting a day right and an hour down moves it there", () => {
    const onMove = vi.fn(async () => {});
    const block = renderHuddle({ onMove });
    press(block, 0, 540);
    moveTo(block, 1, 600);
    release(1, 600);
    expect(onMove).toHaveBeenCalledWith("huddle", "2026-10-27T10:00", "2026-10-27T10:30");
  });

  it("dragging the bottom edge resizes, and a drop back where it was moves nothing", () => {
    const onMove = vi.fn(async () => {});
    const block = renderHuddle({ onMove });
    const handle = block.parentElement!.querySelector("[data-resize-handle]")!;
    press(handle, 0, 570);
    moveTo(handle, 0, 600);
    release(0, 600);
    expect(onMove).toHaveBeenCalledWith("huddle", "2026-10-26T09:00", "2026-10-26T10:00");

    onMove.mockClear();
    press(block, 0, 540, 2);
    moveTo(block, 0, 546, 2); // past the drag threshold, under half a snap
    release(0, 546, 2);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("the click that ends a drag does not open the editor", () => {
    const onOpen = vi.fn();
    const block = renderHuddle({ onOpen });
    press(block, 0, 540);
    moveTo(block, 0, 600);
    release(0, 600);
    fireEvent.click(block);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("a move after a release it never heard about starts no drag", () => {
    const onMove = vi.fn(async () => {});
    const block = renderHuddle({ onMove });
    press(block, 0, 540);
    fireEvent.pointerMove(block, { pointerId: 1, buttons: 0, clientX: x(1), clientY: y(600) });
    release(1, 600);
    expect(onMove).not.toHaveBeenCalled();
  });
});
