// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The client imports the server actions, which pull in clerk/db/audit/Stripe.
// Mock them so the component renders in jsdom and we can assert the exact
// payload the form submits.
vi.mock("../actions", () => ({
  createPromoCodeAction: vi.fn(async () => ({ ok: true, code: "FOUNDER25" })),
  deactivatePromoCodeAction: vi.fn(async () => ({ ok: true })),
}));

import PromoCodesClient from "../promo-codes-client";
import { createPromoCodeAction, deactivatePromoCodeAction } from "../actions";
import type { PromoCodeRow } from "@/lib/billing/promo-codes";

function makeRow(over: Partial<PromoCodeRow> = {}): PromoCodeRow {
  return {
    id: "promo_1",
    code: "FOUNDER25",
    name: "Founder 25",
    discountLabel: "25% off",
    durationLabel: "1 year",
    maxRedemptions: 25,
    timesRedeemed: 3,
    status: "active",
    firstTimeOnly: false,
    expiresAt: null,
    ...over,
  };
}

describe("PromoCodesClient", () => {
  beforeEach(() => {
    vi.mocked(createPromoCodeAction).mockClear().mockResolvedValue({ ok: true, code: "FOUNDER25" });
    vi.mocked(deactivatePromoCodeAction).mockClear().mockResolvedValue({ ok: true });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("submits the form as a percent discount by default", async () => {
    const user = userEvent.setup();
    render(<PromoCodesClient initialCodes={[]} truncated={false} loadError={null} />);

    await user.type(screen.getByPlaceholderText("Founder 25"), "Founder 25");
    await user.type(screen.getByPlaceholderText("FOUNDER25"), "FOUNDER25");
    await user.click(screen.getByRole("button", { name: /Create code/ }));

    await waitFor(() => expect(createPromoCodeAction).toHaveBeenCalledTimes(1));
    expect(createPromoCodeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Founder 25",
        code: "FOUNDER25",
        discountKind: "percent",
        percentOff: 25,
        amountOffDollars: null,
        years: 1,
        maxRedemptions: 25,
      }),
    );
  });

  it("sends dollars instead of a percent once the type is switched", async () => {
    const user = userEvent.setup();
    render(<PromoCodesClient initialCodes={[]} truncated={false} loadError={null} />);

    await user.type(screen.getByPlaceholderText("Founder 25"), "Fifty off");
    await user.selectOptions(screen.getByLabelText(/Discount type/), "amount");
    await user.click(screen.getByRole("button", { name: /Create code/ }));

    await waitFor(() => expect(createPromoCodeAction).toHaveBeenCalledTimes(1));
    expect(createPromoCodeAction).toHaveBeenCalledWith(
      expect.objectContaining({ discountKind: "amount", amountOffDollars: 50, percentOff: null }),
    );
  });

  it("sends the chosen number of years", async () => {
    const user = userEvent.setup();
    render(<PromoCodesClient initialCodes={[]} truncated={false} loadError={null} />);

    await user.type(screen.getByPlaceholderText("Founder 25"), "Two years");
    await user.selectOptions(screen.getByLabelText(/Lasts/), "2");
    await user.click(screen.getByRole("button", { name: /Create code/ }));

    await waitFor(() => expect(createPromoCodeAction).toHaveBeenCalledTimes(1));
    expect(createPromoCodeAction).toHaveBeenCalledWith(expect.objectContaining({ years: 2 }));
  });

  it("shows the code after it is created", async () => {
    const user = userEvent.setup();
    render(<PromoCodesClient initialCodes={[]} truncated={false} loadError={null} />);

    await user.type(screen.getByPlaceholderText("Founder 25"), "Founder 25");
    await user.click(screen.getByRole("button", { name: /Create code/ }));

    expect(await screen.findByText(/is live/)).toBeInTheDocument();
  });

  it("surfaces a failure instead of claiming the code was created", async () => {
    vi.mocked(createPromoCodeAction).mockResolvedValue({ ok: false, error: "Code already exists." });
    const user = userEvent.setup();
    render(<PromoCodesClient initialCodes={[]} truncated={false} loadError={null} />);

    await user.type(screen.getByPlaceholderText("Founder 25"), "Dupe");
    await user.click(screen.getByRole("button", { name: /Create code/ }));

    expect(await screen.findByText("Code already exists.")).toBeInTheDocument();
    expect(screen.queryByText(/is live/)).not.toBeInTheDocument();
  });

  it("lists each code with its discount, length and usage", () => {
    render(<PromoCodesClient initialCodes={[makeRow()]} truncated={false} loadError={null} />);

    const table = within(screen.getByRole("table"));
    expect(table.getByText("FOUNDER25")).toBeInTheDocument();
    expect(table.getByText("25% off")).toBeInTheDocument();
    expect(table.getByText("1 year")).toBeInTheDocument();
    expect(table.getByText("3 / 25")).toBeInTheDocument();
  });

  it("shows an unlimited code's usage without a ceiling", () => {
    render(
      <PromoCodesClient
        initialCodes={[makeRow({ maxRedemptions: null, timesRedeemed: 7 })]}
        truncated={false}
        loadError={null}
      />,
    );
    expect(within(screen.getByRole("table")).getByText("7 / ∞")).toBeInTheDocument();
  });

  it("flags a new-customers-only code in the list", () => {
    render(
      <PromoCodesClient
        initialCodes={[makeRow({ firstTimeOnly: true })]}
        truncated={false}
        loadError={null}
      />,
    );
    expect(within(screen.getByRole("table")).getByText("New only")).toBeInTheDocument();
  });

  it("leaves an unrestricted code unflagged", () => {
    render(<PromoCodesClient initialCodes={[makeRow()]} truncated={false} loadError={null} />);
    expect(screen.queryByText("New only")).not.toBeInTheDocument();
  });

  it("deactivates a code through the action", async () => {
    const user = userEvent.setup();
    render(<PromoCodesClient initialCodes={[makeRow()]} truncated={false} loadError={null} />);

    await user.click(screen.getByRole("button", { name: /Deactivate/ }));

    await waitFor(() => expect(deactivatePromoCodeAction).toHaveBeenCalledWith("promo_1"));
  });

  // Only a live code can be switched off; the rest have nothing left to stop.
  it.each(["inactive", "used up", "expired"] as const)(
    "offers no deactivate button for a %s code",
    (status) => {
      render(
        <PromoCodesClient
          initialCodes={[makeRow({ status })]}
          truncated={false}
          loadError={null}
        />,
      );
      expect(screen.queryByRole("button", { name: /Deactivate/ })).not.toBeInTheDocument();
    },
  );

  it("says the list failed rather than implying there are no codes", () => {
    render(<PromoCodesClient initialCodes={[]} truncated={false} loadError="Stripe unreachable" />);
    expect(screen.getByText(/Stripe unreachable/)).toBeInTheDocument();
    expect(screen.getByText("Codes could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText("No promo codes yet.")).not.toBeInTheDocument();
  });

  it("says the list is capped rather than passing it off as complete", () => {
    render(<PromoCodesClient initialCodes={[makeRow()]} truncated loadError={null} />);
    expect(screen.getByText(/more exist in Stripe than shown here/)).toBeInTheDocument();
    expect(screen.getByText(/Newest codes/)).toBeInTheDocument();
  });

  it("calls the list complete when nothing was dropped", () => {
    render(<PromoCodesClient initialCodes={[makeRow()]} truncated={false} loadError={null} />);
    expect(screen.getByText(/All codes/)).toBeInTheDocument();
    expect(screen.queryByText(/more exist in Stripe/)).not.toBeInTheDocument();
  });
});
