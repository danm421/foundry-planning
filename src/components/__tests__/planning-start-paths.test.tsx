// @vitest-environment jsdom
import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { START_PATHS, PathCard, isStartPath } from "../planning-start-paths";

it("exposes the four start paths in picker order", () => {
  expect(START_PATHS.map((p) => p.id)).toEqual(["quick", "detailed", "import", "empty"]);
  expect(START_PATHS.map((p) => p.title)).toEqual([
    "Quick Start",
    "Detailed setup",
    "AI import",
    "Empty client",
  ]);
  // Card copy is fixed for this picker — pin the subtitles too, or the list can
  // drift while the PathCard test (which supplies its own props) stays green.
  expect(START_PATHS.map((p) => p.subtitle)).toEqual([
    "Fast retirement intake",
    "Full guided wizard",
    "Extract from documents",
    "Skip the wizard, start blank",
  ]);
});

it("narrows only the four known ids", () => {
  expect(isStartPath("quick")).toBe(true);
  expect(isStartPath("empty")).toBe(true);
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
      title="Quick Start"
      subtitle="Fast retirement intake"
      selected={false}
      onSelect={onSelect}
    />,
  );

  const card = screen.getByRole("button", { name: /quick start/i });
  expect(card).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByText("Fast retirement intake")).toBeInTheDocument();

  fireEvent.click(card);
  expect(onSelect).toHaveBeenCalledTimes(1);

  rerender(
    <PathCard
      icon={null}
      title="Quick Start"
      subtitle="Fast retirement intake"
      selected
      onSelect={onSelect}
    />,
  );
  expect(screen.getByRole("button", { name: /quick start/i })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
