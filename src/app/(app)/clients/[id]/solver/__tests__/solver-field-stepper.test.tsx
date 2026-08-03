// @vitest-environment jsdom
import { useCallback, useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SolverFieldStepper } from "../solver-field-stepper";

type HarnessProps = {
  value: number;
  min: number;
  max: number;
  step?: number;
  prefix?: string;
  format?: (n: number) => string;
  onCommit: (n: number) => void;
};

/**
 * The stepper is controlled, so a static `value` prop would mask a stale-closure
 * bug in hold-to-repeat (every tick would re-commit the same number). This
 * harness feeds commits back in, the way the solver's working tree does.
 *
 * `onCommit` is deliberately STABLE across renders. An inline handler would be a
 * new function every render, which by itself invalidates any useCallback the
 * component might wrap its step logic in — and would therefore hide exactly the
 * staleness the hold tests below exist to catch.
 */
function Harness({ onCommit, ...rest }: HarnessProps) {
  const [v, setV] = useState(rest.value);
  const commit = useCallback(
    (n: number) => {
      onCommit(n);
      setV(n);
    },
    [onCommit],
  );
  return <SolverFieldStepper {...rest} id="f" label="Retirement Age" value={v} onCommit={commit} />;
}

function setup(overrides: Partial<HarnessProps> = {}) {
  const onCommit = vi.fn();
  render(<Harness value={65} min={40} max={85} onCommit={onCommit} {...overrides} />);
  return {
    onCommit,
    value: () => screen.getByRole("spinbutton", { name: "Retirement Age" }),
    plus: () => screen.getByRole("button", { name: "Increase Retirement Age" }),
    minus: () => screen.getByRole("button", { name: "Decrease Retirement Age" }),
  };
}

const REPEAT_DELAY = 400;
const BASE_INTERVAL = 125;
const REPEAT_TICKS_BEFORE_FAST = 12;

/**
 * One timer tick per act() call. Batching several ticks into a single act would
 * hold the re-render until the end, so every tick would read the same `value`
 * and a stale-closure bug would sail through.
 */
function tick(ms: number) {
  act(() => void vi.advanceTimersByTime(ms));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("<SolverFieldStepper />", () => {
  it("exposes the value and its bounds as a spinbutton", () => {
    const { value } = setup();
    expect(value()).toHaveAttribute("aria-valuenow", "65");
    expect(value()).toHaveAttribute("aria-valuemin", "40");
    expect(value()).toHaveAttribute("aria-valuemax", "85");
  });

  it("steps up and down by one increment per click", () => {
    const { onCommit, plus, minus, value } = setup();
    fireEvent.click(plus());
    expect(onCommit).toHaveBeenLastCalledWith(66);
    fireEvent.click(minus());
    expect(onCommit).toHaveBeenLastCalledWith(65);
    expect(value()).toHaveAttribute("aria-valuenow", "65");
  });

  it("uses the field's step size rather than 1", () => {
    const { onCommit, plus } = setup({ value: 165_000, min: 0, max: 500_000, step: 5_000, prefix: "$" });
    fireEvent.click(plus());
    expect(onCommit).toHaveBeenLastCalledWith(170_000);
  });

  it("disables the button that would cross a bound", () => {
    const atMax = setup({ value: 85 });
    expect(atMax.plus()).toBeDisabled();
    expect(atMax.minus()).toBeEnabled();
    fireEvent.click(atMax.plus());
    expect(atMax.onCommit).not.toHaveBeenCalled();
  });

  it("disables the decrement button at the minimum", () => {
    const atMin = setup({ value: 40 });
    expect(atMin.minus()).toBeDisabled();
    expect(atMin.plus()).toBeEnabled();
  });

  it("steps with the arrow keys and by ten with page keys", () => {
    const { onCommit, value } = setup();
    fireEvent.keyDown(value(), { key: "ArrowUp" });
    expect(onCommit).toHaveBeenLastCalledWith(66);
    fireEvent.keyDown(value(), { key: "ArrowDown" });
    expect(onCommit).toHaveBeenLastCalledWith(65);
    fireEvent.keyDown(value(), { key: "PageUp" });
    expect(onCommit).toHaveBeenLastCalledWith(75);
    fireEvent.keyDown(value(), { key: "PageDown" });
    expect(onCommit).toHaveBeenLastCalledWith(65);
  });

  it("clamps keyboard steps to the bounds", () => {
    const { onCommit, value } = setup({ value: 84 });
    fireEvent.keyDown(value(), { key: "PageUp" });
    expect(onCommit).toHaveBeenLastCalledWith(85);
  });

  it("opens a text input on click and commits the typed value", () => {
    const { onCommit, value } = setup();
    fireEvent.click(value());
    const input = screen.getByRole("textbox", { name: "Retirement Age" });
    fireEvent.change(input, { target: { value: "72" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenLastCalledWith(72);
    expect(screen.getByRole("spinbutton", { name: "Retirement Age" })).toHaveAttribute(
      "aria-valuenow",
      "72",
    );
  });

  it("clamps a typed value to the bounds", () => {
    const { onCommit, value } = setup();
    fireEvent.click(value());
    const input = screen.getByRole("textbox", { name: "Retirement Age" });
    fireEvent.change(input, { target: { value: "900" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenLastCalledWith(85);
  });

  it("abandons the edit on Escape without committing", () => {
    const { onCommit, value } = setup();
    fireEvent.click(value());
    const input = screen.getByRole("textbox", { name: "Retirement Age" });
    fireEvent.change(input, { target: { value: "72" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole("spinbutton", { name: "Retirement Age" })).toHaveAttribute(
      "aria-valuenow",
      "65",
    );
  });

  it("suspends the step buttons while the value is being typed", () => {
    const { value, plus, minus } = setup();
    fireEvent.click(value());
    expect(plus()).toBeDisabled();
    expect(minus()).toBeDisabled();
  });

  it("holding a step button repeats, advancing the value each tick", () => {
    vi.useFakeTimers();
    const { onCommit, plus, value } = setup();

    fireEvent.pointerDown(plus(), { button: 0 });
    // The press itself steps once; nothing repeats inside the initial delay.
    expect(onCommit).toHaveBeenCalledTimes(1);
    tick(399);
    expect(onCommit).toHaveBeenCalledTimes(1);

    tick(1);
    expect(onCommit).toHaveBeenCalledTimes(2);
    tick(125);
    tick(125);
    tick(125);
    expect(onCommit).toHaveBeenCalledTimes(5);

    // Each tick must read the latest committed value, not the one captured when
    // the hold began — 65 plus five steps.
    expect(onCommit).toHaveBeenLastCalledWith(70);
    expect(value()).toHaveAttribute("aria-valuenow", "70");

    fireEvent.pointerUp(plus());
    tick(1000);
    expect(onCommit).toHaveBeenCalledTimes(5);
  });

  it("accelerates the repeat once the hold is sustained", () => {
    vi.useFakeTimers();
    const { onCommit, plus } = setup({ value: 0, min: 0, max: 1000 });

    fireEvent.pointerDown(plus(), { button: 0 });
    tick(REPEAT_DELAY);
    for (let i = 0; i < REPEAT_TICKS_BEFORE_FAST; i++) tick(BASE_INTERVAL);
    const beforeFast = onCommit.mock.calls.length;

    // Past the acceleration point the base interval now covers two steps.
    tick(BASE_INTERVAL);
    expect(onCommit.mock.calls.length).toBe(beforeFast + 2);
  });

  it("stops repeating when the pointer leaves the button", () => {
    vi.useFakeTimers();
    const { onCommit, plus } = setup();
    fireEvent.pointerDown(plus(), { button: 0 });
    tick(REPEAT_DELAY);
    expect(onCommit).toHaveBeenCalledTimes(2);
    fireEvent.pointerLeave(plus());
    tick(1000);
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it("a held repeat stops at the bound instead of running past it", () => {
    vi.useFakeTimers();
    const { onCommit, plus, value } = setup({ value: 83 });
    fireEvent.pointerDown(plus(), { button: 0 });
    tick(REPEAT_DELAY);
    for (let i = 0; i < 10; i++) tick(BASE_INTERVAL);
    expect(value()).toHaveAttribute("aria-valuenow", "85");
    expect(onCommit.mock.calls.every(([n]) => n <= 85)).toBe(true);
    // 83 → 84 → 85 and then nothing further, rather than one commit per tick.
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it("renders the prefix and formatted value", () => {
    setup({ value: 165_000, min: 0, max: 500_000, step: 5_000, prefix: "$" });
    const value = screen.getByRole("spinbutton", { name: "Retirement Age" });
    expect(value).toHaveTextContent("$165,000");
    expect(value).toHaveAttribute("aria-valuetext", "$165,000");
  });

  it("applies a custom formatter", () => {
    setup({ value: 30, min: 0, max: 100, format: (n) => `${n}%` });
    expect(screen.getByRole("spinbutton", { name: "Retirement Age" })).toHaveTextContent("30%");
  });
});
