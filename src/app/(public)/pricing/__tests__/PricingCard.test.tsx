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

  it("renders the monthly price by default", () => {
    render(<PricingCard />);
    expect(screen.getByText(/\$199/)).toBeInTheDocument();
    expect(screen.getByText(/per month/i)).toBeInTheDocument();
  });

  it("switches to the annual price when the toggle is clicked", () => {
    render(<PricingCard />);
    fireEvent.click(screen.getByRole("button", { name: /annual/i }));
    expect(screen.getByText(/\$1,990/)).toBeInTheDocument();
    expect(screen.getByText(/per year/i)).toBeInTheDocument();
  });

  it("POSTs the right priceKey and redirects on CTA click", async () => {
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
    expect(body).toEqual({ priceKey: "seatMonthly" });
  });

  it("sends seatAnnual when annual is selected", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/y" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(<PricingCard />);
    fireEvent.click(screen.getByRole("button", { name: /annual/i }));
    fireEvent.click(screen.getByRole("button", { name: /start 14-day trial/i }));

    await waitFor(() => {
      const body = JSON.parse(
        (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
      );
      expect(body).toEqual({ priceKey: "seatAnnual" });
    });
  });
});
