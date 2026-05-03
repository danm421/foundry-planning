// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PricingCard from "../PricingCard";

const originalLocation = window.location;

describe("PricingCard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, assign: vi.fn(), href: originalLocation.href },
      writable: true,
    });
  });

  it("renders the annual per-month equivalent by default", () => {
    render(<PricingCard />);
    expect(screen.getByText(/\$166/)).toBeInTheDocument();
    expect(screen.getByText(/billed annually at \$1,990/i)).toBeInTheDocument();
  });

  it("switches to the monthly price when the monthly toggle is clicked", () => {
    render(<PricingCard />);
    fireEvent.click(screen.getByRole("button", { name: /^monthly$/i }));
    expect(screen.getByText(/\$199/)).toBeInTheDocument();
    expect(screen.getByText(/billed monthly/i)).toBeInTheDocument();
  });

  it("POSTs seatAnnual by default and redirects on CTA click", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/x" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(<PricingCard />);
    fireEvent.click(screen.getByRole("button", { name: /start 14-day trial/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/checkout/session",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body).toEqual({ priceKey: "seatAnnual", withAiImport: false });
  });

  it("sends withAiImport=true when the AI Import addon is checked", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/z" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(<PricingCard />);
    fireEvent.click(screen.getByRole("checkbox", { name: /ai import/i }));
    fireEvent.click(screen.getByRole("button", { name: /start 14-day trial/i }));

    await waitFor(() => {
      const body = JSON.parse(
        (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
      );
      expect(body).toEqual({ priceKey: "seatAnnual", withAiImport: true });
    });
  });

  it("sends seatMonthly when monthly is selected", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/y" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(<PricingCard />);
    fireEvent.click(screen.getByRole("button", { name: /^monthly$/i }));
    fireEvent.click(screen.getByRole("button", { name: /start 14-day trial/i }));

    await waitFor(() => {
      const body = JSON.parse(
        (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
      );
      expect(body).toEqual({ priceKey: "seatMonthly", withAiImport: false });
    });
  });
});
