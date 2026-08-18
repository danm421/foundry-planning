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

import type { ComponentProps } from "react";
import PromoCodesClient from "../promo-codes-client";
import { createPromoCodeAction, deactivatePromoCodeAction } from "../actions";
import type { PromoCodeRow } from "@/lib/billing/promo-codes";
import type { PlanPrice } from "@/lib/billing/promo-discount-math";

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

// The real Foundry prices. The gap between them is what makes a flat discount
// sized for the annual plan wipe out the monthly one.
const PLANS: PlanPrice[] = [
  { key: "seatMonthly", label: "Monthly", unitAmountCents: 19_900, productId: "prod_monthly" },
  { key: "seatAnnual", label: "Annual", unitAmountCents: 199_000, productId: "prod_annual" },
];

function renderClient(over: Partial<ComponentProps<typeof PromoCodesClient>> = {}) {
  return render(
    <PromoCodesClient
      initialCodes={[]}
      truncated={false}
      loadError={null}
      plans={PLANS}
      {...over}
    />,
  );
}

describe("PromoCodesClient", () => {
  beforeEach(() => {
    vi.mocked(createPromoCodeAction).mockClear().mockResolvedValue({ ok: true, code: "FOUNDER25" });
    vi.mocked(deactivatePromoCodeAction).mockClear().mockResolvedValue({ ok: true });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("submits the form as a percent discount by default", async () => {
    const user = userEvent.setup();
    renderClient();

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
    renderClient();

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
    renderClient();

    await user.type(screen.getByPlaceholderText("Founder 25"), "Two years");
    await user.selectOptions(screen.getByLabelText(/Lasts/), "2");
    await user.click(screen.getByRole("button", { name: /Create code/ }));

    await waitFor(() => expect(createPromoCodeAction).toHaveBeenCalledTimes(1));
    expect(createPromoCodeAction).toHaveBeenCalledWith(expect.objectContaining({ years: 2 }));
  });

  it("shows the code after it is created", async () => {
    const user = userEvent.setup();
    renderClient();

    await user.type(screen.getByPlaceholderText("Founder 25"), "Founder 25");
    await user.click(screen.getByRole("button", { name: /Create code/ }));

    expect(await screen.findByText(/is live/)).toBeInTheDocument();
  });

  it("surfaces a failure instead of claiming the code was created", async () => {
    vi.mocked(createPromoCodeAction).mockResolvedValue({ ok: false, error: "Code already exists." });
    const user = userEvent.setup();
    renderClient();

    await user.type(screen.getByPlaceholderText("Founder 25"), "Dupe");
    await user.click(screen.getByRole("button", { name: /Create code/ }));

    expect(await screen.findByText("Code already exists.")).toBeInTheDocument();
    expect(screen.queryByText(/is live/)).not.toBeInTheDocument();
  });

  it("lists each code with its discount, length and usage", () => {
    renderClient({ initialCodes: [makeRow()] });

    const table = within(screen.getByRole("table"));
    expect(table.getByText("FOUNDER25")).toBeInTheDocument();
    expect(table.getByText("25% off")).toBeInTheDocument();
    expect(table.getByText("1 year")).toBeInTheDocument();
    expect(table.getByText("3 / 25")).toBeInTheDocument();
  });

  it("shows an unlimited code's usage without a ceiling", () => {
    renderClient({ initialCodes: [makeRow({ maxRedemptions: null, timesRedeemed: 7 })] });
    expect(within(screen.getByRole("table")).getByText("7 / ∞")).toBeInTheDocument();
  });

  it("flags a new-customers-only code in the list", () => {
    renderClient({ initialCodes: [makeRow({ firstTimeOnly: true })] });
    expect(within(screen.getByRole("table")).getByText("New only")).toBeInTheDocument();
  });

  it("leaves an unrestricted code unflagged", () => {
    renderClient({ initialCodes: [makeRow()] });
    expect(screen.queryByText("New only")).not.toBeInTheDocument();
  });

  it("deactivates a code through the action", async () => {
    const user = userEvent.setup();
    renderClient({ initialCodes: [makeRow()] });

    await user.click(screen.getByRole("button", { name: /Deactivate/ }));

    await waitFor(() => expect(deactivatePromoCodeAction).toHaveBeenCalledWith("promo_1"));
  });

  // Only a live code can be switched off; the rest have nothing left to stop.
  it.each(["inactive", "used up", "expired"] as const)(
    "offers no deactivate button for a %s code",
    (status) => {
      renderClient({ initialCodes: [makeRow({ status })] });
      expect(screen.queryByRole("button", { name: /Deactivate/ })).not.toBeInTheDocument();
    },
  );

  it("says the list failed rather than implying there are no codes", () => {
    renderClient({ loadError: "Stripe unreachable" });
    expect(screen.getByText(/Stripe unreachable/)).toBeInTheDocument();
    expect(screen.getByText("Codes could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText("No promo codes yet.")).not.toBeInTheDocument();
  });

  it("says the list is capped rather than passing it off as complete", () => {
    renderClient({ initialCodes: [makeRow()], truncated: true });
    expect(screen.getByText(/more exist in Stripe than shown here/)).toBeInTheDocument();
    expect(screen.getByText(/Newest codes/)).toBeInTheDocument();
  });

  it("calls the list complete when nothing was dropped", () => {
    renderClient({ initialCodes: [makeRow()] });
    expect(screen.getByText(/All codes/)).toBeInTheDocument();
    expect(screen.queryByText(/more exist in Stripe/)).not.toBeInTheDocument();
  });

  it("previews what each plan would bill before the code exists", () => {
    renderClient();
    // The default 25% off, priced against both plans.
    expect(screen.getByText("$149.25")).toBeInTheDocument();
    expect(screen.getByText("$1,492.50")).toBeInTheDocument();
  });

  // The case that shipped: a discount sized for the annual plan, which the
  // monthly plan is smaller than.
  it("shows a flat discount emptying the monthly plan and refuses to submit it", async () => {
    const user = userEvent.setup();
    renderClient();

    await user.selectOptions(screen.getByLabelText(/Discount type/), "amount");
    const amount = screen.getByLabelText(/Dollars off/);
    await user.clear(amount);
    await user.type(amount, "200");

    expect(screen.getByText("$0.00")).toBeInTheDocument();
    expect(screen.getByText(/would pay nothing/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create code/ })).toBeDisabled();
  });

  it("takes the same discount once it is under the cheapest plan", async () => {
    const user = userEvent.setup();
    renderClient();

    await user.selectOptions(screen.getByLabelText(/Discount type/), "amount");
    const amount = screen.getByLabelText(/Dollars off/);
    await user.clear(amount);
    await user.type(amount, "150");

    expect(screen.queryByText(/would pay nothing/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create code/ })).toBeEnabled();
  });

  it("caps both inputs where they would start zeroing a plan", async () => {
    const user = userEvent.setup();
    renderClient();

    expect(screen.getByLabelText(/Percent off/)).toHaveAttribute("max", "99");
    await user.selectOptions(screen.getByLabelText(/Discount type/), "amount");
    // A cent under the $199 monthly plan.
    expect(screen.getByLabelText(/Dollars off/)).toHaveAttribute("max", "198.99");
  });

  // Prices are only needed to preview. The server refuses a zeroing discount
  // whatever the form managed to show, so a Stripe hiccup must not lock the
  // form — it just stops showing the numbers.
  it("drops the preview when the prices are unavailable, without blocking the form", () => {
    renderClient({ plans: [] });
    expect(screen.queryByText(/Applies to/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create code/ })).toBeEnabled();
  });
});

describe("PromoCodesClient targeting", () => {
  const monthlyBox = () => screen.getByRole("checkbox", { name: /Monthly/ });
  const annualBox = () => screen.getByRole("checkbox", { name: /Annual/ });
  const createBtn = () => screen.getByRole("button", { name: /Create code/ });

  it("covers every plan until told otherwise", () => {
    renderClient();
    expect(monthlyBox()).toBeChecked();
    expect(annualBox()).toBeChecked();
  });

  // An excluded plan stays on the list. The bug that started this was a plan
  // nobody remembered was included, so a plan silently vanishing when unticked
  // would trade one invisible plan for another.
  it("keeps an unticked plan visible and marks it not included", async () => {
    const user = userEvent.setup();
    renderClient();
    await user.click(monthlyBox());

    expect(monthlyBox()).not.toBeChecked();
    expect(screen.getByText(/not included/)).toBeInTheDocument();
    // Priced at 25% off, the annual plan still shows its discount…
    expect(screen.getByText("$1,492.50")).toBeInTheDocument();
    // …while the monthly plan no longer shows one.
    expect(screen.queryByText("$149.25")).not.toBeInTheDocument();
  });

  // The capability the whole Stripe split exists to restore.
  it("accepts $200 off once the plan it would empty is out of scope", async () => {
    const user = userEvent.setup();
    renderClient();

    await user.selectOptions(screen.getByLabelText(/Discount type/), "amount");
    const amount = screen.getByLabelText(/Dollars off/);
    await user.clear(amount);
    await user.type(amount, "200");
    expect(createBtn()).toBeDisabled();

    await user.click(monthlyBox());

    expect(screen.queryByText(/would pay nothing/)).not.toBeInTheDocument();
    expect(createBtn()).toBeEnabled();
  });

  it("raises the dollars cap to the cheapest plan still in scope", async () => {
    const user = userEvent.setup();
    renderClient();
    await user.selectOptions(screen.getByLabelText(/Discount type/), "amount");
    expect(screen.getByLabelText(/Dollars off/)).toHaveAttribute("max", "198.99");

    await user.click(monthlyBox());
    // A cent under the $1,990 annual plan, now that it is the cheapest in scope.
    expect(screen.getByLabelText(/Dollars off/)).toHaveAttribute("max", "1989.99");
  });

  it("refuses to submit a code that covers no plan at all", async () => {
    const user = userEvent.setup();
    renderClient();
    await user.click(monthlyBox());
    await user.click(annualBox());

    expect(screen.getByText(/Pick at least one plan/)).toBeInTheDocument();
    expect(createBtn()).toBeDisabled();
  });

  it("sends only the ticked products to the action", async () => {
    const user = userEvent.setup();
    renderClient();
    await user.type(screen.getByLabelText(/^Name/), "Annual only");
    await user.click(monthlyBox());
    await user.click(createBtn());

    await waitFor(() => expect(createPromoCodeAction).toHaveBeenCalled());
    expect(createPromoCodeAction).toHaveBeenCalledWith(
      expect.objectContaining({ productIds: ["prod_annual"] }),
    );
  });
});
