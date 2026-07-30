// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { WalkthroughOverlay } from "../walkthrough-overlay";
import { WalkthroughContext, type WalkthroughContextValue } from "../walkthrough-context";
import { getWalkthrough } from "@/domain/forge/help/catalog";

function renderWith(overrides: Partial<WalkthroughContextValue>) {
  const w = getWalkthrough("add-household")!;
  const value: WalkthroughContextValue = {
    active: w,
    stepIndex: 0,
    currentStep: w.steps[0],
    start: vi.fn(),
    next: vi.fn(),
    exit: vi.fn(),
    ...overrides,
  };
  render(
    <WalkthroughContext.Provider value={value}>
      <WalkthroughOverlay />
    </WalkthroughContext.Provider>,
  );
  return value;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

// jsdom implements no scrollIntoView — the found-branch calls it on mount.
// Matches the existing polyfill convention in portal-mobile-nav.test.tsx.
Element.prototype.scrollIntoView = vi.fn();

describe("WalkthroughOverlay", () => {
  it("renders the current step callout + step counter when the anchor is present", () => {
    const el = document.createElement("a");
    el.setAttribute("data-forge-anchor", "crm-new-household-button");
    document.body.appendChild(el);
    renderWith({});
    expect(screen.getByText(/Click "New household"/)).toBeTruthy();
    expect(screen.getByText(/Step 1 of 5/)).toBeTruthy();
  });

  it("Exit calls exit()", () => {
    const el = document.createElement("a");
    el.setAttribute("data-forge-anchor", "crm-new-household-button");
    document.body.appendChild(el);
    const value = renderWith({});
    fireEvent.click(screen.getByRole("button", { name: /exit/i }));
    expect(value.exit).toHaveBeenCalled();
  });

  it("shows a text fallback (with Exit) when the anchor never appears", async () => {
    vi.useFakeTimers();
    const value = renderWith({}); // anchor NOT in DOM
    await act(async () => {
      vi.advanceTimersByTime(4200);
    });
    expect(screen.getByText(/couldn.t find/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /exit/i }));
    expect(value.exit).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("on a click-gated step, offers the do-the-action hint instead of a dead Next", () => {
    const w = getWalkthrough("add-household")!;
    const save = w.steps[w.steps.length - 1];
    expect(save.advanceOn).toBe("click"); // guard: this test's premise
    const el = document.createElement("button");
    el.setAttribute("data-forge-anchor", save.anchorId);
    document.body.appendChild(el);
    renderWith({ stepIndex: w.steps.length - 1, currentStep: save });
    // A "Next" here could never enable — canAdvance only flips for manual/input.
    expect(screen.queryByRole("button", { name: /^next$/i })).toBeNull();
    expect(screen.getByText(/Do the highlighted action to continue/i)).toBeTruthy();
  });

  it("on a manual step, Next is enabled and calls next()", () => {
    const w = getWalkthrough("add-household")!;
    const el = document.createElement("div");
    el.setAttribute("data-forge-anchor", "crm-primary-contact-fields");
    document.body.appendChild(el);
    const value = renderWith({ stepIndex: 1, currentStep: w.steps[1] }); // manual
    const nextBtn = screen.getByRole("button", { name: /next/i }) as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(false);
    fireEvent.click(nextBtn);
    expect(value.next).toHaveBeenCalled();
  });
});
