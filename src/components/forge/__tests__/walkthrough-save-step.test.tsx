// @vitest-environment jsdom
//
// The add-household tour's last step spotlights the "Create household" button.
// Since /crm/new stopped navigating on save (it opens StartPlanningPrompt in
// place), that step MUST end the tour on the click itself. If it doesn't, the
// z-[80] walkthrough scrim outlives the click and paints over the prompt —
// DialogShell renders at z-50 with no portal — leaving the four planning cards
// dimmed and pointer-blocked. These tests pin the teardown ordering.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { WalkthroughProvider } from "../walkthrough-provider";
import { useWalkthrough } from "../walkthrough-context";
import { CrmHouseholdForm } from "@/components/crm-household-form";
import { getWalkthrough } from "@/domain/forge/help/catalog";

const pushMock = vi.fn();
const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
  usePathname: () => "/crm/new",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ user: { id: "user_1" }, isLoaded: true }),
}));

// jsdom implements no scrollIntoView — the overlay's found-branch calls it.
Element.prototype.scrollIntoView = vi.fn();

/** Drives the tour to its final (save-button) step from inside the provider. */
function TourDriver() {
  const { start, next, stepIndex } = useWalkthrough();
  return (
    <div>
      <span data-testid="step">{stepIndex}</span>
      <button onClick={() => start("add-household")}>drive-start</button>
      <button onClick={() => next()}>drive-next</button>
    </div>
  );
}

/** The overlay paints its 4-rectangle scrim as `fixed z-[80] bg-black/50` divs. */
function scrimCount() {
  return document.querySelectorAll('div[class*="z-[80]"]').length;
}
function calloutEl() {
  return document.querySelector('[aria-label="Guided walkthrough"]');
}

beforeEach(() => {
  pushMock.mockReset();
  replaceMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("add-household tour: the save step vs. the start-planning prompt", () => {
  it("advances on the click itself, not on a navigation that no longer happens", () => {
    const w = getWalkthrough("add-household")!;
    const save = w.steps[w.steps.length - 1];
    expect(save.anchorId).toBe("crm-household-save-button");
    // /crm/new no longer routes away on save, so a navigate-gated final step
    // can never be satisfied by the happy path.
    expect(save.advanceOn).toBe("click");
    expect(save.nextPage).toBeUndefined();
  });

  it("tears the scrim down on the save click, before the prompt renders", async () => {
    // Hold the create POST open so "before the prompt renders" is a fact of the
    // test's control flow, not a race we happened to win.
    let releasePost!: () => void;
    const posted = new Promise<void>((resolve) => {
      releasePost = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        posted.then(() => ({
          ok: true,
          json: async () => ({ household: { id: "hh-1", name: "John Smith" } }),
        })),
      ),
    );

    render(
      <WalkthroughProvider>
        <TourDriver />
        <CrmHouseholdForm mode="create" />
      </WalkthroughProvider>,
    );

    // step 0 is navigate→/crm/new, which the mocked pathname satisfies at once,
    // so start() lands on step 1; three manual advances reach the save step (4).
    act(() => void screen.getByText("drive-start").click());
    for (let i = 0; i < 3; i++) act(() => void screen.getByText("drive-next").click());
    expect(screen.getByTestId("step").textContent).toBe("4");

    // The tour is live and painting over the page.
    expect(screen.getByText(/Step 5 of 5/)).toBeTruthy();
    expect(scrimCount()).toBeGreaterThan(0);

    const saveButton = screen.getByRole("button", { name: /create household/i });
    fireEvent.change(screen.getByLabelText(/^first name$/i), { target: { value: "John" } });
    fireEvent.change(screen.getByLabelText(/^last name$/i), { target: { value: "Smith" } });
    fireEvent.change(screen.getByLabelText(/state of residence/i), { target: { value: "CA" } });

    act(() => void fireEvent.click(saveButton));

    // The POST is still in flight, so the prompt cannot exist yet — and the
    // scrim + callout are already gone. This is the ordering that matters.
    expect(screen.queryByRole("dialog", { name: /household created/i })).toBeNull();
    expect(scrimCount()).toBe(0);
    expect(calloutEl()).toBeNull();

    // …and they stay gone once the prompt mounts, so the cards are clickable.
    await act(async () => {
      releasePost();
      await posted;
    });
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /household created/i })).toBeInTheDocument(),
    );
    expect(scrimCount()).toBe(0);
    expect(calloutEl()).toBeNull();
    expect(screen.getByRole("button", { name: /guided/i })).toBeInTheDocument();
  });
});
