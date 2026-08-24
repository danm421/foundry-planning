// @vitest-environment jsdom
import type { ComponentType } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { PRESENTATION_PAGES } from "@/components/presentations/registry";

type AnyOptionsControl = ComponentType<{ value: never; onChange: (next: never) => void }>;

/**
 * Every Early Years sheet lets the advisor swap its tidbits, so every one of
 * them has to offer the way back. `TidbitPicker` renders the button only when a
 * caller hands it that page's defaults — deliberately, since a reset with
 * nothing behind it would clear the selection instead of restoring it. The
 * consequence is that a new sheet which forgets to pass them ships with the
 * button silently missing, and only this test would notice.
 */
const EARLY_YEARS = Object.values(PRESENTATION_PAGES).filter(
  (p) => p.category === "Early Years",
);

afterEach(cleanup);

describe("Early Years options controls", () => {
  it("covers every sheet in the deck", () => {
    expect(EARLY_YEARS.length).toBeGreaterThanOrEqual(7);
  });

  for (const page of EARLY_YEARS) {
    it(`${page.id} offers a reset back to its defaults`, () => {
      const Options = page.OptionsControl as AnyOptionsControl | undefined;
      if (!Options) throw new Error(`${page.id} has no options control`);
      render(<Options value={page.defaultOptions as never} onChange={vi.fn()} />);
      const button = screen.getByText("Reset to default") as HTMLButtonElement;
      // Inert here, because the page is showing exactly its defaults — which is
      // also what proves the button was wired to THIS page's defaults and not
      // to some other array.
      expect(button.disabled, page.id).toBe(true);
    });
  }

  it("goes live the moment a pick changes, and restores what the page shipped", () => {
    const page = PRESENTATION_PAGES.earlyYearsStanding;
    const Options = page.OptionsControl!;
    const onChange = vi.fn();
    const shipped = page.defaultOptions.tidbits;
    render(<Options value={{ ...page.defaultOptions, tidbits: [] }} onChange={onChange} />);
    const button = screen.getByText("Reset to default") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tidbits: shipped }));
  });
});
