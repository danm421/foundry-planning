// @vitest-environment jsdom
/**
 * Tests for the IntakeClient "use client" wrapper.
 * Mocks IntakeWizard to expose controlled onChange/onSubmit triggers.
 * Mocks fetch to test autosave debounce + submit error paths.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ─── Mock IntakeWizard ────────────────────────────────────────────────────────
// Exposes controlled buttons that invoke onChange / onSubmit so tests can
// exercise the client wrapper's fetch wiring without a full wizard render.

vi.mock("@/components/intake/intake-wizard", () => ({
  IntakeWizard: ({
    onSubmit,
    onChange,
    error,
    busy,
  }: {
    onSubmit: () => Promise<void>;
    onChange: (d: unknown) => void;
    error?: string | null;
    busy?: boolean;
    value: unknown;
    mode: string;
  }) => (
    <div data-testid="wizard">
      {error && <p role="alert">{error}</p>}
      {busy && <span data-testid="busy" />}
      <button onClick={() => onChange({ family: { primary: { firstName: "Test" } } })}>
        change
      </button>
      <button onClick={() => void onSubmit()}>submit</button>
    </div>
  ),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { IntakeClient } from "../intake-client";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("IntakeClient submit wiring", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    // Ensure fake timers are always restored even if a test throws mid-way
    vi.useRealTimers();
  });

  it("POSTs current value to /api/intake/[token]/submit on submit and flips to thank-you on 200", async () => {
    const user = userEvent.setup();
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    } as Response);

    render(
      <IntakeClient token="tok1" recipientName="Test User" initialPayload={{}} />,
    );

    await user.click(screen.getByRole("button", { name: "submit" }));

    // Should flip to thank-you
    expect(await screen.findByRole("heading", { name: /thank you, test user/i })).toBeInTheDocument();
    expect(screen.queryByTestId("wizard")).not.toBeInTheDocument();

    // fetch was called with the right endpoint + method
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/intake/tok1/submit",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces 422 validation error message", async () => {
    const user = userEvent.setup();
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({
        error: "Incomplete form",
        issues: [{ message: "firstName is required" }],
      }),
    } as Response);

    render(
      <IntakeClient token="tok1" recipientName={null} initialPayload={{}} />,
    );

    await user.click(screen.getByRole("button", { name: "submit" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/firstName is required/i);
    // Wizard is still showing (not flipped to thank-you)
    expect(screen.getByTestId("wizard")).toBeInTheDocument();
  });

  it("surfaces 403 advisory message when firm subscription is inactive", async () => {
    const user = userEvent.setup();
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: "Subscription inactive." }),
    } as Response);

    render(<IntakeClient token="tok1" recipientName={null} initialPayload={{}} />);

    await user.click(screen.getByRole("button", { name: "submit" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/not currently active/i);
  });

  it("treats 409 (already submitted) as success and flips to thank-you", async () => {
    const user = userEvent.setup();
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: "Already submitted." }),
    } as Response);

    render(<IntakeClient token="tok1" recipientName={null} initialPayload={{}} />);

    await user.click(screen.getByRole("button", { name: "submit" }));

    expect(await screen.findByRole("heading", { name: /thank you\./i })).toBeInTheDocument();
  });

  it("shows expired-link message on 410", async () => {
    const user = userEvent.setup();
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 410,
      json: async () => ({ error: "Link expired." }),
    } as Response);

    render(<IntakeClient token="tok1" recipientName={null} initialPayload={{}} />);

    await user.click(screen.getByRole("button", { name: "submit" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/link has expired/i);
  });

  it("debounces onChange and PATCHes /api/intake/[token] once after idle", async () => {
    vi.useFakeTimers();

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    } as Response);

    render(<IntakeClient token="tok2" recipientName={null} initialPayload={{}} />);

    const changeBtn = screen.getByRole("button", { name: "change" });

    // Fire onChange three times rapidly — synchronous, all within the debounce window
    act(() => { fireEvent.click(changeBtn); });
    act(() => { fireEvent.click(changeBtn); });
    act(() => { fireEvent.click(changeBtn); });

    // No fetch yet — debounce hasn't fired
    expect(global.fetch).not.toHaveBeenCalled();

    // Advance past debounce threshold and flush all pending microtasks
    await act(async () => {
      vi.advanceTimersByTime(1000);
      // Two rounds to let setTimeout callback + the fetch promise both resolve
      await Promise.resolve();
      await Promise.resolve();
    });

    // Only ONE PATCH should have been issued (debounce coalesced all three clicks)
    const patchCalls = vi.mocked(global.fetch).mock.calls.filter(
      (c) => c[1] && (c[1] as RequestInit).method === "PATCH",
    );
    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0][0]).toBe("/api/intake/tok2");
  });

  it("a failed autosave surfaces a non-blocking error without losing the wizard", async () => {
    vi.useFakeTimers();

    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as Response);

    render(<IntakeClient token="tok3" recipientName={null} initialPayload={{}} />);

    const changeBtn = screen.getByRole("button", { name: "change" });
    act(() => { fireEvent.click(changeBtn); });

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Error message is shown but wizard is still mounted (autosave failures are non-blocking)
    // Use getByRole (synchronous) — the DOM is already updated after the await act above.
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByTestId("wizard")).toBeInTheDocument();
  });
});
