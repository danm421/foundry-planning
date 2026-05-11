// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
  usePathname: vi.fn(),
}));

// jsdom's `localStorage` is missing `setItem` in this vitest setup; stub it so
// the hook's write-through doesn't throw and leak into the test output.
beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
});

import { ComparisonPickerBar } from "../comparison-picker-bar";

const CLIENT_ID = "c1";
const PATH = "/clients/c1/comparison";

const SCENARIOS = [
  { id: "sid_a", name: "Roth Convert", isBaseCase: false },
  { id: "sid_b", name: "Sell RE", isBaseCase: false },
  { id: "sid_c", name: "Gift Plan", isBaseCase: false },
];

let pushSpy: ReturnType<typeof vi.fn>;

function setup(search: string) {
  pushSpy = vi.fn();
  vi.mocked(useRouter).mockReturnValue({ push: pushSpy, replace: vi.fn() } as never);
  vi.mocked(usePathname).mockReturnValue(PATH);
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams(search) as never);
  return render(
    <ComparisonPickerBar
      clientId={CLIENT_ID}
      scenarios={SCENARIOS}
      snapshots={[]}
      drawerPlans={[]}
    />,
  );
}

describe("ComparisonPickerBar (dynamic chips)", () => {
  it("renders 2 chips when ?plans=base,base", () => {
    setup("plans=base,base");
    expect(screen.getAllByRole("group", { name: /plan \d+/i })).toHaveLength(2);
  });

  it("renders 4 chips when ?plans has 4 entries", () => {
    setup("plans=base,sid_a,sid_b,sid_c");
    expect(screen.getAllByRole("group", { name: /plan \d+/i })).toHaveLength(4);
  });

  it("marks the first chip as BASELINE", () => {
    setup("plans=base,sid_a");
    const baseline = screen.getByText(/baseline/i);
    expect(baseline).toBeInTheDocument();
  });

  it("hides + Add at length 4", () => {
    setup("plans=base,sid_a,sid_b,sid_c");
    expect(screen.queryByRole("button", { name: /add plan/i })).not.toBeInTheDocument();
  });

  it("shows + Add at length < 4", () => {
    setup("plans=base,sid_a");
    expect(screen.getByRole("button", { name: /add plan/i })).toBeInTheDocument();
  });

  it("clicking + Add pushes plans=...,base", () => {
    setup("plans=base,sid_a");
    fireEvent.click(screen.getByRole("button", { name: /add plan/i }));
    expect(pushSpy).toHaveBeenLastCalledWith(`${PATH}?plans=base%2Csid_a%2Cbase`);
  });

  it("× on a non-baseline chip removes that entry", () => {
    setup("plans=base,sid_a,sid_b");
    const removes = screen.getAllByRole("button", { name: /remove plan/i });
    expect(removes).toHaveLength(2); // baseline has no remove
    fireEvent.click(removes[0]); // removes chip at index 1
    expect(pushSpy).toHaveBeenLastCalledWith(`${PATH}?plans=base%2Csid_b`);
  });

  it("disables × when only 2 chips remain", () => {
    setup("plans=base,sid_a");
    const removes = screen.getAllByRole("button", { name: /remove plan/i });
    expect(removes).toHaveLength(1);
    expect(removes[0]).toBeDisabled();
  });

  it("Make baseline rotates the chosen chip to index 0", () => {
    setup("plans=base,sid_a,sid_b");
    fireEvent.click(screen.getAllByRole("button", { name: /more options/i })[1]); // chip index 2
    fireEvent.click(screen.getByRole("menuitem", { name: /make baseline/i }));
    expect(pushSpy).toHaveBeenLastCalledWith(`${PATH}?plans=sid_b%2Cbase%2Csid_a`);
  });
});
