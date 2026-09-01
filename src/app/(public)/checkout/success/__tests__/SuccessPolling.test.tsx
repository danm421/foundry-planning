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
  mockSetActive.mockReset().mockResolvedValue(undefined);
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
    mockSetActive.mockRejectedValue(new Error("nope"));
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
