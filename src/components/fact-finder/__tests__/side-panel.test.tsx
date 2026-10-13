// @vitest-environment jsdom
// src/components/fact-finder/__tests__/side-panel.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SidePanel } from "../side-panel";

/** The panel's top edge in the window; a test moves it as the page would. */
let top = 230;

beforeEach(() => {
  top = 230;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    () => ({ top, bottom: top + 400, left: 1056, right: 1416, width: 360, height: 400 }) as DOMRect,
  );
  vi.stubGlobal("innerHeight", 900);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const panel = ({ open = true, overlay = false } = {}) => (
  <SidePanel id="panel" title="Documents & chat" open={open} overlay={overlay} onOpenChange={() => {}} footer={<p>Composer</p>}>
    <p>Documents</p>
  </SidePanel>
);
const aside = () => screen.getByRole("complementary", { name: "Documents & chat" });

/** The window's scroll and resize listeners in a spy's calls, with whether each listens on the way down (a removal must match). */
const listeners = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls
    .filter(([type]) => type === "scroll" || type === "resize")
    .map(([type, listener, options]) => [type, listener, (options as EventListenerOptions | undefined)?.capture ?? false]);

describe("beside the page, the panel ends above the Forge button (window height − its top − 84 px)", () => {
  it("measures from where it sits: lower before the page scrolls, at its sticky line once it does", () => {
    render(panel());
    expect(aside().style.maxHeight).toBe("586px"); // 900 − 230 − 84

    top = 100;
    fireEvent.scroll(window);
    expect(aside().style.maxHeight).toBe("716px"); // 900 − 100 − 84
  });

  it("measures again when the window is resized, and when a scroller inside the page scrolls", () => {
    const { container } = render(panel());

    vi.stubGlobal("innerHeight", 700);
    fireEvent(window, new Event("resize"));
    expect(aside().style.maxHeight).toBe("386px"); // 700 − 230 − 84

    // On desktop the Details pane scrolls on its own; its scroll events don't bubble to the window.
    top = 150;
    fireEvent.scroll(container);
    expect(aside().style.maxHeight).toBe("466px"); // 700 − 150 − 84
  });

  it("is never shorter than 240 px, nor taller than at its sticky line", () => {
    top = 700;
    render(panel());
    expect(aside().style.maxHeight).toBe("240px");

    top = -300; // the end of the page pushes it up past its sticky line
    fireEvent.scroll(window);
    expect(aside().style.maxHeight).toBe("716px");
  });

  it("stops listening once it closes, and once it's gone", () => {
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");

    const { rerender, unmount } = render(panel());
    expect(listeners(added)).toHaveLength(2);
    rerender(panel({ open: false }));
    expect(listeners(removed)).toEqual(listeners(added));

    rerender(panel());
    expect(aside().style.maxHeight).toBe("586px");
    expect(listeners(added)).toHaveLength(4);
    unmount();
    expect(listeners(removed)).toEqual(listeners(added));
  });
});

it("the drawer below 1100 px takes the window's full height: nothing to measure", () => {
  const added = vi.spyOn(window, "addEventListener");
  render(panel({ overlay: true }));
  expect(listeners(added)).toEqual([]);
  expect(screen.getByRole("dialog", { name: "Documents & chat" }).style.maxHeight).toBe("");
});
