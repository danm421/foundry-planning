// @vitest-environment jsdom
// src/app/(public)/checkout/success/__tests__/SuccessPolling.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const mockSetActive = vi.fn();
const mockPush = vi.fn();
vi.mock("@clerk/nextjs", () => ({
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

beforeEach(() => {
  // A real Clerk setActive() is a network round trip, not an already-resolved
  // promise. An instantly-resolved mock lets the awaited setActive() call
  // race React's own scheduled re-render + passive-effect cleanup — and that
  // race is non-deterministic here (measured: a bare `setTimeout(fn, 0)`
  // mock let the cancel-on-cleanup defect slip through 2-4 times per 10 runs).
  // A real, if small, delay reliably lets React's cleanup land first, which
  // is what actually happens in production (the cleanup is cheap; a network
  // round trip is not) and is the exact window the defect dies in.
  mockSetActive.mockReset().mockImplementation(
    () => new Promise((resolve) => setTimeout(resolve, 20)),
  );
  mockPush.mockReset();
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
      () => new Promise((_, reject) => setTimeout(() => reject(new Error("nope")), 20)),
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
});
