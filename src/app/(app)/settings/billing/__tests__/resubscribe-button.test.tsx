// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockStart = vi.fn();
vi.mock("../actions", () => ({
  startResubscribeCheckout: (...a: unknown[]) => mockStart(...a),
}));

import ResubscribeButton from "../resubscribe-button";

beforeEach(() => {
  mockStart.mockReset();
});

const subscribe = () => screen.getByRole("button", { name: /subscribe/i });

describe("<ResubscribeButton>", () => {
  it("hands the buyer to the Stripe URL the action returns", async () => {
    // The step that used to be untestable: without an injectable navigate,
    // a handler that called the action and then dropped the URL would pass.
    const navigate = vi.fn();
    mockStart.mockResolvedValue({ ok: true, url: "https://checkout.stripe.com/c/pay/cs_1" });
    render(<ResubscribeButton navigate={navigate} />);
    await userEvent.click(subscribe());
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_1"),
    );
  });

  // One click per render: after a successful hand-off the button stays in its
  // "Opening Stripe…" state, because in the real flow the page is leaving.
  it("defaults to annual", async () => {
    mockStart.mockResolvedValue({ ok: true, url: "https://checkout.stripe.com/c/pay/cs_1" });
    const { unmount } = render(<ResubscribeButton navigate={vi.fn()} />);
    await userEvent.click(subscribe());
    expect((mockStart.mock.calls[0][0] as FormData).get("plan")).toBe("annual");
    unmount();
  });

  it("sends monthly when the buyer picks it", async () => {
    mockStart.mockResolvedValue({ ok: true, url: "https://checkout.stripe.com/c/pay/cs_1" });
    render(<ResubscribeButton navigate={vi.fn()} />);
    await userEvent.click(screen.getByRole("radio", { name: /monthly/i }));
    await userEvent.click(subscribe());
    expect((mockStart.mock.calls[0][0] as FormData).get("plan")).toBe("monthly");
  });

  it("stays busy after a successful hand-off — the page is on its way out", async () => {
    mockStart.mockResolvedValue({ ok: true, url: "https://checkout.stripe.com/c/pay/cs_1" });
    render(<ResubscribeButton navigate={vi.fn()} />);
    await userEvent.click(subscribe());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /opening stripe/i })).toHaveProperty(
        "disabled",
        true,
      ),
    );
  });

  it("shows the error inline and does NOT navigate when the action fails", async () => {
    const navigate = vi.fn();
    mockStart.mockResolvedValue({ ok: false, error: "We couldn't reach payments." });
    render(<ResubscribeButton navigate={navigate} />);
    await userEvent.click(subscribe());
    await waitFor(() => expect(screen.getByRole("alert")).not.toBeNull());
    expect(screen.getByText(/couldn't reach payments/i)).not.toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("re-enables the button after a failure so they can retry", async () => {
    mockStart.mockResolvedValue({ ok: false, error: "nope" });
    render(<ResubscribeButton navigate={vi.fn()} />);
    await userEvent.click(subscribe());
    await waitFor(() => expect(subscribe()).toHaveProperty("disabled", false));
  });
});
