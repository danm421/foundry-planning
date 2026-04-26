// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { ToggleList } from "../toggle-list";
import type { ToggleGroup } from "@/engine/scenario/types";

const setToggleMock = vi.fn();
let mockToggleSet = new Set<string>();

vi.mock("@/hooks/use-compare-state", () => ({
  useCompareState: () => ({
    left: "base",
    right: "base",
    toggleSet: mockToggleSet,
    setSide: vi.fn(),
    setToggle: setToggleMock,
  }),
}));

function makeGroup(overrides: Partial<ToggleGroup> = {}): ToggleGroup {
  return {
    id: "g-1",
    scenarioId: "s-1",
    name: "Roth conversions",
    defaultOn: false,
    requiresGroupId: null,
    orderIndex: 0,
    ...overrides,
  };
}

// IntersectionObserver shim that synchronously fires "intersecting" once an
// element is observed, so deltaFetcher resolution kicks in immediately.
class ImmediateIO implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: ReadonlyArray<number> = [];
  constructor(private cb: IntersectionObserverCallback) {}
  observe(target: Element) {
    // Defer to the next microtask so React effects mount first.
    queueMicrotask(() => {
      this.cb(
        [{ isIntersecting: true, target } as IntersectionObserverEntry],
        this,
      );
    });
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

describe("ToggleList", () => {
  beforeEach(() => {
    setToggleMock.mockClear();
    mockToggleSet = new Set();
    vi.stubGlobal("IntersectionObserver", ImmediateIO);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the TOGGLES header and one row per group", () => {
    render(
      <ToggleList
        clientId="c1"
        groups={[
          makeGroup({ id: "g-1", name: "Roth conversions" }),
          makeGroup({ id: "g-2", name: "Early retirement" }),
        ]}
        deltaFetcher={() =>
          new Promise(() => {
            /* never resolves */
          })
        }
      />,
    );
    expect(screen.getByText("TOGGLES")).toBeInTheDocument();
    expect(screen.getByTestId("toggle-row-g-1")).toBeInTheDocument();
    expect(screen.getByTestId("toggle-row-g-2")).toBeInTheDocument();
    expect(screen.getByText("Roth conversions")).toBeInTheDocument();
    expect(screen.getByText("Early retirement")).toBeInTheDocument();
  });

  it("returns null when groups is empty", () => {
    const { container } = render(
      <ToggleList
        clientId="c1"
        groups={[]}
        deltaFetcher={() =>
          new Promise(() => {
            /* never resolves */
          })
        }
      />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("toggle-list")).not.toBeInTheDocument();
  });

  it("dims and disables a row whose required parent is off", () => {
    mockToggleSet = new Set<string>(); // parent g-parent NOT in set
    render(
      <ToggleList
        clientId="c1"
        groups={[
          makeGroup({
            id: "g-child",
            name: "Child group",
            requiresGroupId: "g-parent",
          }),
        ]}
        deltaFetcher={() =>
          new Promise(() => {
            /* never resolves */
          })
        }
      />,
    );
    const row = screen.getByTestId("toggle-row-g-child");
    expect(row.className).toContain("opacity-40");
    const btn = screen.getByRole("button", { name: /Toggle on/ });
    expect(btn).toBeDisabled();

    fireEvent.click(btn);
    expect(setToggleMock).not.toHaveBeenCalled();
  });

  it("clicking the toggle calls setToggle with the group id and the flipped value", () => {
    mockToggleSet = new Set<string>(); // currently off
    render(
      <ToggleList
        clientId="c1"
        groups={[makeGroup({ id: "g-1", name: "Roth conversions" })]}
        deltaFetcher={() =>
          new Promise(() => {
            /* never resolves */
          })
        }
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Toggle on/ }));
    expect(setToggleMock).toHaveBeenCalledTimes(1);
    expect(setToggleMock).toHaveBeenCalledWith("g-1", true);
  });

  it("when interactive=false, the toggle button is disabled and clicks do not invoke setToggle", () => {
    mockToggleSet = new Set<string>();
    render(
      <ToggleList
        clientId="c1"
        groups={[makeGroup({ id: "g-1", name: "Roth conversions" })]}
        deltaFetcher={() =>
          new Promise(() => {
            /* never resolves */
          })
        }
        interactive={false}
      />,
    );
    const row = screen.getByTestId("toggle-row-g-1");
    // Visual cue: the row carries opacity-60 in read-only mode.
    expect(row.className).toContain("opacity-60");
    const btn = screen.getByRole("button", { name: /Toggle on/ });
    expect(btn).toBeDisabled();

    fireEvent.click(btn);
    expect(setToggleMock).not.toHaveBeenCalled();
  });

  it("renders the pill only after deltaFetcher resolves", async () => {
    const fetcher = vi.fn(
      async (): Promise<{ delta: number; metricLabel: string }> => ({
        delta: -250_000,
        metricLabel: "end-of-plan portfolio",
      }),
    );

    render(
      <ToggleList
        clientId="c1"
        groups={[makeGroup({ id: "g-1", name: "Roth conversions" })]}
        deltaFetcher={fetcher}
      />,
    );

    // Pill not present synchronously
    expect(screen.queryByTestId("toggle-row-pill-g-1")).toBeNull();

    await waitFor(() => {
      expect(screen.getByTestId("toggle-row-pill-g-1")).toBeInTheDocument();
    });
    expect(fetcher).toHaveBeenCalledWith("g-1");
    const pill = screen.getByTestId("toggle-row-pill-g-1");
    expect(pill).toHaveTextContent("−$250k");
    expect(pill).toHaveTextContent("end-of-plan portfolio");
    // Negative delta carries the red token
    expect(pill.className).toContain("c87a7a");
  });
});
