// @vitest-environment jsdom
// src/app/(setup)/welcome/__tests__/setup-form.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockSave = vi.fn();
const mockUpload = vi.fn();
const mockStart = vi.fn();
vi.mock("../actions", () => ({
  saveSignupProfile: (...a: unknown[]) => mockSave(...a),
  uploadSignupLogo: (...a: unknown[]) => mockUpload(...a),
  startSignupCheckout: (...a: unknown[]) => mockStart(...a),
}));

import { SetupForm } from "../setup-form";

const EMPTY = { firmName: "", advisorName: "", primaryColor: null, logoUrl: null };

beforeEach(() => {
  vi.clearAllMocks();
  mockSave.mockResolvedValue({ ok: true });
  mockStart.mockResolvedValue({ ok: true, url: "https://checkout.stripe.com/c/pay/x" });
  // jsdom ships no object-URL store, so the optimistic preview's
  // URL.createObjectURL(file) would throw. The value is opaque to the form.
  URL.createObjectURL = vi.fn(() => "blob:local-preview");
  URL.revokeObjectURL = vi.fn();
});

describe("the setup step", () => {
  it("will not continue without a firm name — nothing can provision without it", () => {
    render(<SetupForm initial={EMPTY} plan="annual" />);
    expect(screen.getByRole("button", { name: /continue to payment/i })).toBeDisabled();
  });

  it("continues on the firm name alone, with branding untouched", async () => {
    // Branding is OPTIONAL. If it can ever gate the card, this design has failed.
    render(<SetupForm initial={EMPTY} plan="annual" />);
    await userEvent.type(screen.getByLabelText(/firm name/i), "Acme Wealth");
    expect(screen.getByRole("button", { name: /continue to payment/i })).toBeEnabled();
  });

  it("shows the firm name on the report preview as it is typed", async () => {
    // The whole premise: every input has to visibly buy them something.
    render(<SetupForm initial={EMPTY} plan="annual" />);
    await userEvent.type(screen.getByLabelText(/firm name/i), "Acme Wealth");
    expect(await screen.findByTestId("cover-preview")).toHaveTextContent("Acme Wealth");
  });

  it("saves the profile and hands off to Stripe", async () => {
    render(<SetupForm initial={EMPTY} plan="annual" />);
    await userEvent.type(screen.getByLabelText(/firm name/i), "Acme Wealth");
    await userEvent.click(screen.getByRole("button", { name: /continue to payment/i }));
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith(
        // `plan` is asserted here, not just firmName: it is a value this form
        // SUPPLIES, so nothing else in the suite watches it, and objectContaining
        // on firmName alone passes just as happily when plan is missing.
        expect.objectContaining({ firmName: "Acme Wealth", plan: "annual" }),
      ),
    );
    await waitFor(() => expect(mockStart).toHaveBeenCalled());
  });

  it("carries a monthly buyer's plan through to the stash", async () => {
    // The money case. startSignupCheckout prices off PLAN_PRICE_KEY[stash.plan],
    // and coerce() in pending-signup.ts defaults an unwritten plan to "annual" —
    // so a monthly buyer whose plan never leaves this form pays the annual price.
    render(<SetupForm initial={EMPTY} plan="monthly" />);
    await userEvent.type(screen.getByLabelText(/firm name/i), "Acme Wealth");
    await userEvent.click(screen.getByRole("button", { name: /continue to payment/i }));
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({ plan: "monthly" }),
      ),
    );
  });

  it("surfaces a failed upload inline and still lets them pay", async () => {
    mockUpload.mockResolvedValue({ ok: false, error: "Logo must be 2 MB or smaller" });
    render(<SetupForm initial={{ ...EMPTY, firmName: "Acme" }} plan="annual" />);
    const file = new File([new Uint8Array([1])], "logo.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText(/logo/i), file);
    expect(await screen.findByText(/2 MB or smaller/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue to payment/i })).toBeEnabled();
  });

  it("waits for an in-flight upload, and is not sunk by one that throws", async () => {
    // Behaviour contract 4: an upload still in flight DELAYS the card, it never
    // fails it. Both halves are load-bearing and neither is otherwise watched —
    // drop the `await uploadInFlight.current` and the first assertion goes red;
    // drop the `.catch()` on the upload chain and the rejection escapes
    // onContinue, so the buyer sits on a spinner forever and the last one does.
    let breakUpload!: (reason: Error) => void;
    mockUpload.mockReturnValue(
      new Promise<never>((_resolve, reject) => {
        breakUpload = reject;
      }),
    );
    render(<SetupForm initial={{ ...EMPTY, firmName: "Acme" }} plan="annual" />);
    const file = new File([new Uint8Array([1])], "logo.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText(/logo/i), file);
    await userEvent.click(screen.getByRole("button", { name: /continue to payment/i }));

    expect(mockSave).not.toHaveBeenCalled();

    breakUpload(new Error("the network died mid-upload"));
    await waitFor(() => expect(mockStart).toHaveBeenCalled());
  });

  it("renders the logo they already uploaded when they come back", async () => {
    // Someone who abandoned at the card must find their work intact.
    render(
      <SetupForm
        initial={{ ...EMPTY, firmName: "Acme", logoUrl: "https://blob.example/logo.png" }}
        plan="annual"
      />,
    );
    expect(await screen.findByAltText(/your logo/i)).toHaveAttribute(
      "src",
      "https://blob.example/logo.png",
    );
  });
});
