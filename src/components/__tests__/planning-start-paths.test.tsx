// @vitest-environment jsdom
import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { START_PATHS, PathCard, isStartPath } from "../planning-start-paths";

it("exposes the three start paths in picker order", () => {
  expect(START_PATHS.map((p) => p.id)).toEqual(["guided", "import", "empty"]);
  expect(START_PATHS.map((p) => p.title)).toEqual(["Guided", "AI import", "Empty client"]);
  // Card copy is fixed for this picker — pin the subtitles too, or the list can
  // drift while the PathCard test (which supplies its own props) stays green.
  expect(START_PATHS.map((p) => p.subtitle)).toEqual([
    "Full step-by-step wizard",
    "Extract from documents",
    "Skip the wizard, start blank",
  ]);
});

it("narrows only the three known ids", () => {
  expect(isStartPath("guided")).toBe(true);
  expect(isStartPath("empty")).toBe(true);
  // The sunset Quick Start path and the pre-rename "detailed" id must not
  // survive in stale `?path=` links.
  expect(isStartPath("quick")).toBe(false);
  expect(isStartPath("detailed")).toBe(false);
  expect(isStartPath("bogus")).toBe(false);
  expect(isStartPath("")).toBe(false);
  expect(isStartPath(null)).toBe(false);
  expect(isStartPath(undefined)).toBe(false);
});

it("renders a card, reports its pressed state, and reports selection", () => {
  const onSelect = vi.fn();
  const { rerender } = render(
    <PathCard
      icon={null}
      title="Guided"
      subtitle="Full step-by-step wizard"
      selected={false}
      onSelect={onSelect}
    />,
  );

  const card = screen.getByRole("button", { name: /guided/i });
  expect(card).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByText("Full step-by-step wizard")).toBeInTheDocument();

  fireEvent.click(card);
  expect(onSelect).toHaveBeenCalledTimes(1);

  rerender(
    <PathCard
      icon={null}
      title="Guided"
      subtitle="Full step-by-step wizard"
      selected
      onSelect={onSelect}
    />,
  );
  expect(screen.getByRole("button", { name: /guided/i })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

it("omits aria-pressed entirely when selected is not passed (navigate-only callers)", () => {
  render(
    <PathCard
      icon={null}
      title="Guided"
      subtitle="Full step-by-step wizard"
      onSelect={vi.fn()}
    />,
  );

  const card = screen.getByRole("button", { name: /guided/i });
  // aria-pressed="false" is a PRESENT attribute and would pass a naive
  // truthiness check — assert absence specifically, not falsiness.
  expect(card).not.toHaveAttribute("aria-pressed");
});
