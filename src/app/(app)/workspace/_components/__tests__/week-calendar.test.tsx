// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WeekCalendar, type WeekEvent } from "../week-calendar";

type Row = WeekEvent;

/** The connection every row comes from; a row's key is `${connectionId}:${id}`, as the route builds it. */
const CONN = "conn-1";

function row(over: Partial<Row> & Pick<Row, "id" | "start" | "end">): Row {
  return {
    key: `${CONN}:${over.id}`,
    connectionId: CONN,
    provider: "microsoft",
    subject: over.id,
    isAllDay: false,
    isOrganizer: true,
    isCancelled: false,
    type: "singleInstance",
    attendees: [],
    meetingUrl: null,
    iCalUid: null,
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
    expect(onOpen).toHaveBeenCalledWith(`${CONN}:huddle`);
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
    expect(onOpen).toHaveBeenCalledWith(`${CONN}:huddle`);
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

  it("(F5) a narrow calendar gets one-letter day names over the date, by the calendar's own width", () => {
    const { rerender } = render(
      <WeekCalendar {...noop} weekStart="2026-10-26" days={5} events={[]} today="2026-10-28" />,
    );
    const calendar = screen.getByRole("region", { name: "Week calendar" });
    expect(calendar).toHaveClass("@container");
    // Full names need ~52px a day: 44px of hours + 5 × 52 = 304px.
    expect(screen.getByText("Wed")).toHaveClass("hidden", "@min-[304px]:inline");
    expect(screen.getAllByText("W")[0]).toHaveClass("@min-[304px]:hidden");
    // Narrow, the letter sits over the date; wide, beside it.
    expect(screen.getByText("Wed").parentElement).toHaveClass("flex-col", "@min-[304px]:flex-row");

    // Seven days need 44 + 7 × 52 = 408px.
    rerender(<WeekCalendar {...noop} weekStart="2026-10-26" days={7} events={[]} today="2026-10-28" />);
    expect(screen.getByText("Sun")).toHaveClass("hidden", "@min-[408px]:inline");
    expect(screen.getAllByText("S")).toHaveLength(2);
    expect(screen.getAllByText("S")[1]).toHaveClass("@min-[408px]:hidden");
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

  it("clicking the household link goes to the household, not the editor", () => {
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
            id: "review",
            start: "2026-10-27T10:00",
            end: "2026-10-27T11:30",
            household: { householdId: "hh-1", householdName: "Hartley" },
          }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("link", { name: "Hartley" }));
    expect(onOpen).not.toHaveBeenCalled();
  });
});

/** The positioned box a timed meeting is drawn in. */
const boxOf = (subject: string) => screen.getByText(subject).closest<HTMLElement>("[style]")!;

describe("WeekCalendar — short meetings (F1, F2, F10)", () => {
  function renderOne(over: Partial<Row> & Pick<Row, "start" | "end">, onOpen = vi.fn()) {
    render(
      <WeekCalendar
        {...noop}
        onOpen={onOpen}
        weekStart="2026-10-26"
        days={5}
        today="2026-10-28"
        events={[row({ id: "m", subject: "Quick sync", ...over })]}
      />,
    );
    return onOpen;
  }

  it("the subject is the box's first line and can't be squeezed out (no flex column to shrink it)", () => {
    renderOne({ start: "2026-10-26T09:00", end: "2026-10-26T10:00" });
    const box = boxOf("Quick sync");
    const button = screen.getByRole("button", { name: /Quick sync/ });
    expect(box).not.toHaveClass("flex");
    expect(box.firstElementChild).toBe(button);
    expect(button.firstElementChild).toHaveTextContent("Quick sync");
    expect(button.firstElementChild).toHaveClass("block", "truncate");
    // An hour has room for the time too.
    expect(screen.getByText("9:00 – 10:00")).not.toHaveClass("sr-only");
  });

  it.each([
    ["15", "2026-10-26T09:15"],
    ["30", "2026-10-26T09:30"],
  ])("a %s-minute box shows only its subject: the time is for screen readers, the household link is left off", (_min, end) => {
    renderOne({
      start: "2026-10-26T09:00",
      end,
      household: { householdId: "hh-1", householdName: "Hartley" },
    });
    expect(screen.getByText(/^9:00 – 9:(15|30)$/)).toHaveClass("sr-only");
    expect(screen.queryByRole("link", { name: "Hartley" })).toBeNull();
    expect(boxOf("Quick sync")).toHaveClass("py-0.5");
  });

  it("a 45-minute box has room for the time and the household", () => {
    renderOne({
      start: "2026-10-26T09:00",
      end: "2026-10-26T09:45",
      household: { householdId: "hh-1", householdName: "Hartley" },
    });
    expect(screen.getByText("9:00 – 9:45")).not.toHaveClass("sr-only");
    expect(screen.getByRole("link", { name: "Hartley" })).toBeInTheDocument();
  });

  it("a click on the box's padding opens the editor", () => {
    const onOpen = renderOne({ start: "2026-10-26T09:00", end: "2026-10-26T09:15" });
    fireEvent.click(boxOf("Quick sync"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("a press on the resize handle that doesn't move opens the editor", () => {
    const onOpen = renderOne({ start: "2026-10-26T09:00", end: "2026-10-26T09:15" });
    const handle = boxOf("Quick sync").querySelector("[data-resize-handle]")!;
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, buttons: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.click(handle);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("a short box's resize handle is a thin edge, so it can't take most presses", () => {
    renderOne({ start: "2026-10-26T09:00", end: "2026-10-26T09:15" });
    expect(boxOf("Quick sync").querySelector("[data-resize-handle]")).toHaveClass("h-[3px]");
  });

  it("(F10) a meeting just before midnight stops at the bottom of the grid", () => {
    renderOne({ start: "2026-10-26T23:45", end: "2026-10-26T23:55" });
    const box = boxOf("Quick sync");
    const top = parseFloat(box.style.top);
    const height = parseFloat(box.style.height);
    expect(top).toBe(1425 * 0.8);
    // 15 minutes to midnight, not the 20-minute minimum: 12px less the 2px gap.
    expect(height).toBe(10);
    expect(top + height).toBeLessThanOrEqual(24 * 48);
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
    expect(onMove).toHaveBeenCalledWith(`${CONN}:huddle`, "2026-10-27T10:00", "2026-10-27T10:30");
  });

  it("dragging the bottom edge resizes, and a drop back where it was moves nothing", () => {
    const onMove = vi.fn(async () => {});
    const block = renderHuddle({ onMove });
    const handle = block.parentElement!.querySelector("[data-resize-handle]")!;
    press(handle, 0, 570);
    moveTo(handle, 0, 600);
    release(0, 600);
    expect(onMove).toHaveBeenCalledWith(`${CONN}:huddle`, "2026-10-26T09:00", "2026-10-26T10:00");

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

  it("dragging the resize handle resizes; it doesn't open the editor", () => {
    const onMove = vi.fn(async () => {});
    const onOpen = vi.fn();
    const block = renderHuddle({ onMove, onOpen });
    const handle = block.parentElement!.querySelector("[data-resize-handle]")!;
    press(handle, 0, 570);
    moveTo(handle, 0, 600);
    release(0, 600);
    fireEvent.click(handle);
    expect(onMove).toHaveBeenCalledWith(`${CONN}:huddle`, "2026-10-26T09:00", "2026-10-26T10:00");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("(F8) Escape mid-drag puts the meeting back and sends nothing", () => {
    const onMove = vi.fn(async () => {});
    const onOpen = vi.fn();
    const block = renderHuddle({ onMove, onOpen });
    press(block, 0, 540);
    moveTo(block, 1, 600);
    // Mid-drag it's drawn in Tuesday's column at 10:00.
    expect(screen.getByRole("button", { name: /Team huddle/ }).parentElement!.style.top).toBe(`${600 * 0.8}px`);

    fireEvent.keyDown(window, { key: "Escape" });
    const back = screen.getByRole("button", { name: /Team huddle/ }).parentElement!;
    expect(back.style.top).toBe(`${540 * 0.8}px`);

    moveTo(calendar(), 2, 660); // further moves are ignored
    release(2, 660);
    fireEvent.click(back);
    expect(onMove).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    expect(back.style.top).toBe(`${540 * 0.8}px`);
  });

  it("(F3) a touch press never starts a drag, so the calendar can scroll; a tap still opens it", () => {
    const onMove = vi.fn(async () => {});
    const onOpen = vi.fn();
    const block = renderHuddle({ onMove, onOpen });
    const box = block.parentElement!;
    // No `touch-action: none`: a swipe that starts on a meeting scrolls the week.
    expect(box).not.toHaveClass("touch-none");

    fireEvent.pointerDown(block, { pointerId: 7, pointerType: "touch", button: 0, buttons: 1, clientX: x(0), clientY: y(540) });
    fireEvent.pointerMove(block, { pointerId: 7, pointerType: "touch", buttons: 1, clientX: x(1), clientY: y(600) });
    fireEvent.pointerUp(calendar(), { pointerId: 7, pointerType: "touch", clientX: x(1), clientY: y(600) });
    expect(Element.prototype.setPointerCapture).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();

    fireEvent.pointerDown(block, { pointerId: 8, pointerType: "touch", button: 0, buttons: 1, clientX: x(0), clientY: y(545) });
    fireEvent.pointerUp(block, { pointerId: 8, pointerType: "touch", clientX: x(0), clientY: y(545) });
    fireEvent.click(block);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("a pen still drags like a mouse", () => {
    const onMove = vi.fn(async () => {});
    const block = renderHuddle({ onMove });
    fireEvent.pointerDown(block, { pointerId: 3, pointerType: "pen", button: 0, buttons: 1, clientX: x(0), clientY: y(540) });
    fireEvent.pointerMove(block, { pointerId: 3, pointerType: "pen", buttons: 1, clientX: x(1), clientY: y(600) });
    fireEvent.pointerUp(calendar(), { pointerId: 3, pointerType: "pen", clientX: x(1), clientY: y(600) });
    expect(onMove).toHaveBeenCalledWith(`${CONN}:huddle`, "2026-10-27T10:00", "2026-10-27T10:30");
  });

  it("a move after a release it never heard about starts no drag", () => {
    const onMove = vi.fn(async () => {});
    const block = renderHuddle({ onMove });
    press(block, 0, 540);
    fireEvent.pointerMove(block, { pointerId: 1, buttons: 0, clientX: x(1), clientY: y(600) });
    release(1, 600);
    expect(onMove).not.toHaveBeenCalled();
  });

  describe("account labels", () => {
    const events = [row({ id: "standup", start: "2026-10-27T10:00", end: "2026-10-27T11:00" })];
    const labels = new Map([[CONN, "foundryplanning"]]);

    it("with labels, a block shows its account's tag", () => {
      render(
        <WeekCalendar {...noop} weekStart="2026-10-26" days={5} events={events} today="2026-10-28" labels={labels} />,
      );
      expect(screen.getByText("foundryplanning")).toBeInTheDocument();
    });

    it("without labels, no tag", () => {
      render(<WeekCalendar {...noop} weekStart="2026-10-26" days={5} events={events} today="2026-10-28" />);
      expect(screen.queryByText("foundryplanning")).toBeNull();
    });
  });
});
