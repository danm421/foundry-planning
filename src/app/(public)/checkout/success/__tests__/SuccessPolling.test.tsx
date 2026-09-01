// @vitest-environment jsdom
// src/app/(public)/checkout/success/__tests__/SuccessPolling.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockSetActive = vi.fn();
const mockPush = vi.fn();
// The self-serve buyer signed up BEFORE paying, so they are signed in and still
// org-less while the webhook provisions their firm. The sales-path buyer has no
// account at all — the invitation is what makes them one.
let authState: { isSignedIn: boolean; orgId: string | null | undefined } = {
  isSignedIn: true,
  orgId: null,
};
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => authState,
  useOrganizationList: () => ({ isLoaded: true, setActive: mockSetActive }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

import SuccessPolling from "../SuccessPolling";

function respond(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }),
  );
}

// 30 attempts at 1.5s ≈ 45s. Enough to walk the poller all the way to its cap.
const PAST_THE_POLL_CAP_MS = 60_000;

/** Drain React's render + passive effects, then run `ms` of fake time. The
 *  first drain matters: the timers this component sets are created INSIDE
 *  effects that only run once the first fetch has resolved. */
async function runFakeTime(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

// A real Clerk setActive() is a network round trip, not an already-resolved
// promise. An instantly-resolved mock lets the awaited setActive() call
// race React's own scheduled re-render + passive-effect cleanup — and that
// race is non-deterministic here (measured: a bare `setTimeout(fn, 0)` mock
// let the cancel-on-cleanup defect slip through 2-4 times per 10 runs). A
// real, if small, delay reliably lets React's cleanup land first, which is
// what actually happens in production (the cleanup is cheap; a network
// round trip is not) and is the exact window the defect dies in.
const NETWORK_DELAY_MS = 20;

beforeEach(() => {
  mockSetActive.mockReset().mockImplementation(
    () => new Promise((resolve) => setTimeout(resolve, NETWORK_DELAY_MS)),
  );
  mockPush.mockReset();
  authState = { isSignedIn: true, orgId: null };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("checkout success", () => {
  it("activates the new firm and walks the buyer into the app", async () => {
    // This is what replaces the invitation email. No inbox round trip.
    respond({ ready: true, firmName: "Acme Wealth", buyerEmail: "d***@a.example", firmId: "org_new" });
    render(<SuccessPolling sessionId="cs_test_123" />);
    await waitFor(() => expect(mockSetActive).toHaveBeenCalledWith({ organization: "org_new" }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/home"));
  });

  it("never tells a self-serve buyer to check their email", async () => {
    respond({ ready: true, firmName: "Acme Wealth", buyerEmail: "d***@a.example", firmId: "org_new" });
    render(<SuccessPolling sessionId="cs_test_123" />);
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(screen.queryByText(/invite/i)).not.toBeInTheDocument();
  });

  it("offers a manual way in when activation fails, rather than dead-ending", async () => {
    mockSetActive.mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error("nope")), NETWORK_DELAY_MS)),
    );
    respond({ ready: true, firmName: "Acme Wealth", buyerEmail: "d***@a.example", firmId: "org_new" });
    render(<SuccessPolling sessionId="cs_test_123" />);
    expect(await screen.findByRole("link", { name: /continue to your workspace/i }))
      .toHaveAttribute("href", "/home");
  });

  it("keeps the invitation copy for the sales path, which has no firmId", async () => {
    // Hand-built runbook sessions still email an invite; that screen must stay.
    respond({ ready: true, firmName: "Runbook Firm", buyerEmail: "b***@f.example" });
    render(<SuccessPolling sessionId="cs_test_456" />);
    expect(await screen.findByText(/sign-in invite/i)).toBeInTheDocument();
    expect(mockSetActive).not.toHaveBeenCalled();
  });

  describe("when provisioning outruns the poller", () => {
    it("never promises a self-serve buyer an invitation that is not coming", async () => {
      // Removing that email is the entire point of this build, and this is the
      // one screen where a stranded buyer reads carefully.
      vi.useFakeTimers();
      respond({ ready: false });
      render(<SuccessPolling sessionId="cs_test_123" />);
      await runFakeTime(PAST_THE_POLL_CAP_MS);
      expect(screen.queryByText(/invite/i)).not.toBeInTheDocument();
      expect(screen.getByText(/nothing to pay again/i)).toBeInTheDocument();
    });

    it("offers another look rather than a route back into a second Checkout", async () => {
      // They are signed in and org-less, so /select-organization → "Set up your
      // firm" → /welcome → "Continue to payment" is a second org and a second
      // subscription for someone who has already paid. "Check again" re-polls.
      vi.useFakeTimers();
      respond({ ready: false });
      render(<SuccessPolling sessionId="cs_test_123" />);
      await runFakeTime(PAST_THE_POLL_CAP_MS);
      const hrefs = screen.queryAllByRole("link").map((a) => a.getAttribute("href"));
      expect(hrefs).not.toContain("/welcome");
      expect(hrefs).not.toContain("/select-organization");

      respond({ ready: true, firmName: "Acme Wealth", buyerEmail: "d***@a.example", firmId: "org_new" });
      fireEvent.click(screen.getByRole("button", { name: /check again/i }));
      await runFakeTime(1000);
      expect(mockSetActive).toHaveBeenCalledWith({ organization: "org_new" });
    });

    it("keeps the invitation copy for the sales path, whose buyer really is emailed", async () => {
      authState = { isSignedIn: false, orgId: null };
      vi.useFakeTimers();
      respond({ ready: false });
      render(<SuccessPolling sessionId="cs_test_456" />);
      await runFakeTime(PAST_THE_POLL_CAP_MS);
      expect(screen.getByText(/sign-in invite/i)).toBeInTheDocument();
    });
  });

  it("does not strand the buyer on 'Opening your workspace…' when setActive never settles", async () => {
    // The catch already covers a REJECTED setActive. A call that neither
    // resolves nor rejects had no cap at all, and left the spinner up forever.
    vi.useFakeTimers();
    mockSetActive.mockImplementation(() => new Promise(() => {}));
    respond({ ready: true, firmName: "Acme Wealth", buyerEmail: "d***@a.example", firmId: "org_new" });
    render(<SuccessPolling sessionId="cs_test_123" />);
    await runFakeTime(30_000);
    expect(screen.getByRole("link", { name: /continue to your workspace/i }))
      .toHaveAttribute("href", "/home");
    expect(screen.queryByText(/opening your workspace/i)).not.toBeInTheDocument();
  });
});
