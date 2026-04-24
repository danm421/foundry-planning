// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import ClientSearch from "../client-search";

const originalFetch = global.fetch;

beforeEach(() => {
  vi.useFakeTimers();
  pushMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  global.fetch = originalFetch;
});

function stubFetch(results: Array<{ id: string; householdTitle: string }>) {
  global.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(results), { status: 200 }),
  ) as typeof fetch;
}

describe("ClientSearch", () => {
  it("renders an input", () => {
    render(<ClientSearch />);
    expect(screen.getByPlaceholderText(/search clients/i)).toBeDefined();
  });

  it("does not fetch for empty query", async () => {
    stubFetch([]);
    render(<ClientSearch />);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("fetches after 200ms debounce", async () => {
    stubFetch([{ id: "1", householdTitle: "Alice Anderson" }]);
    render(<ClientSearch />);
    const input = screen.getByPlaceholderText(/search clients/i);
    fireEvent.change(input, { target: { value: "alice" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(global.fetch).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/clients/search?q=alice",
      expect.anything(),
    );
  });

  it("renders results in a dropdown", async () => {
    stubFetch([
      { id: "1", householdTitle: "Alice Anderson" },
      { id: "2", householdTitle: "Bob Baxter" },
    ]);
    render(<ClientSearch />);
    fireEvent.change(screen.getByPlaceholderText(/search clients/i), { target: { value: "a" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(screen.getByText("Alice Anderson")).toBeDefined();
    expect(screen.getByText("Bob Baxter")).toBeDefined();
  });

  it("shows 'No matches' when results are empty", async () => {
    stubFetch([]);
    render(<ClientSearch />);
    fireEvent.change(screen.getByPlaceholderText(/search clients/i), { target: { value: "xyz" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(screen.getByText(/no matches/i)).toBeDefined();
  });

  it("navigates on Enter when a result is highlighted", async () => {
    stubFetch([{ id: "abc", householdTitle: "Alice Anderson" }]);
    render(<ClientSearch />);
    const input = screen.getByPlaceholderText(/search clients/i);
    fireEvent.change(input, { target: { value: "a" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(pushMock).toHaveBeenCalledWith("/clients/abc/overview");
  });

  it("closes on Escape", async () => {
    stubFetch([{ id: "1", householdTitle: "Alice Anderson" }]);
    render(<ClientSearch />);
    const input = screen.getByPlaceholderText(/search clients/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "a" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(screen.getByText("Alice Anderson")).toBeDefined();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByText("Alice Anderson")).toBeNull();
  });

  it("moves highlight down with ArrowDown", async () => {
    stubFetch([
      { id: "1", householdTitle: "Alice" },
      { id: "2", householdTitle: "Bob" },
    ]);
    render(<ClientSearch />);
    const input = screen.getByPlaceholderText(/search clients/i);
    fireEvent.change(input, { target: { value: "a" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(pushMock).toHaveBeenCalledWith("/clients/2/overview");
  });

  it("silently hides dropdown on fetch error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("boom")) as typeof fetch;
    render(<ClientSearch />);
    fireEvent.change(screen.getByPlaceholderText(/search clients/i), { target: { value: "a" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
