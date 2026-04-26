// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { SnapshotButton } from "../snapshot-button";

const refreshMock = vi.fn();
let mockLeft = "base";
let mockRight = "base";
let mockToggleSet = new Set<string>();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/hooks/use-compare-state", () => ({
  useCompareState: () => ({
    left: mockLeft,
    right: mockRight,
    toggleSet: mockToggleSet,
    setSide: vi.fn(),
    setToggle: vi.fn(),
  }),
}));

let fetchMock: ReturnType<typeof vi.fn>;
let promptMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  refreshMock.mockReset();
  mockLeft = "base";
  mockRight = "base";
  mockToggleSet = new Set();

  fetchMock = vi.fn();
  promptMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("prompt", promptMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SnapshotButton", () => {
  it("is disabled when left === right (no diff to freeze)", () => {
    mockLeft = "base";
    mockRight = "base";
    render(<SnapshotButton clientId="c1" />);
    const btn = screen.getByTestId("snapshot-button") as HTMLButtonElement;
    expect(btn).toBeDisabled();
  });

  it("is enabled when sides differ", () => {
    mockLeft = "base";
    mockRight = "s1";
    render(<SnapshotButton clientId="c1" />);
    const btn = screen.getByTestId("snapshot-button") as HTMLButtonElement;
    expect(btn).not.toBeDisabled();
  });

  it("is disabled when the external `disabled` prop is true (right side is a snapshot)", () => {
    mockLeft = "base";
    mockRight = "snap:abc";
    render(<SnapshotButton clientId="c1" disabled />);
    const btn = screen.getByTestId("snapshot-button") as HTMLButtonElement;
    expect(btn).toBeDisabled();
  });

  it("does not fetch when prompt is cancelled", () => {
    mockLeft = "base";
    mockRight = "s1";
    promptMock.mockReturnValueOnce(null);

    render(<SnapshotButton clientId="c1" />);
    fireEvent.click(screen.getByTestId("snapshot-button"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("does not fetch when prompt returns whitespace-only string", () => {
    mockLeft = "base";
    mockRight = "s1";
    promptMock.mockReturnValueOnce("   ");

    render(<SnapshotButton clientId="c1" />);
    fireEvent.click(screen.getByTestId("snapshot-button"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs to the snapshots route with the current sides + trimmed name and refreshes the router on success", async () => {
    mockLeft = "base";
    mockRight = "s1";
    mockToggleSet = new Set(["g-1", "g-2"]);
    promptMock.mockReturnValueOnce("  My snapshot  ");
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ snapshot: { id: "snap-new" } }),
    });

    render(<SnapshotButton clientId="c-42" />);
    fireEvent.click(screen.getByTestId("snapshot-button"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/clients/c-42/snapshots");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      left: "base",
      right: "s1",
      toggleState: { "g-1": true, "g-2": true },
      name: "My snapshot",
      sourceKind: "manual",
    });

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
  });

  it("does not refresh the router when the POST fails", async () => {
    mockLeft = "base";
    mockRight = "s1";
    promptMock.mockReturnValueOnce("Whatever");
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "boom",
    });

    // Silence the expected console.error from the failure branch so the test
    // output stays clean.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<SnapshotButton clientId="c1" />);
    fireEvent.click(screen.getByTestId("snapshot-button"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(refreshMock).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
