// @vitest-environment jsdom
// src/app/(setup)/welcome/__tests__/setup-form.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockSave = vi.fn();
const mockUpload = vi.fn();
const mockStart = vi.fn();
// The hand-off to Stripe. Injected rather than left to window.location, which
// jsdom cannot follow: it prints "Not implemented: navigation" and no test can
// see whether the buyer was sent to the URL Stripe actually returned.
const mockNavigate = vi.fn();
vi.mock("../actions", () => ({
  saveSignupProfile: (...a: unknown[]) => mockSave(...a),
  uploadSignupLogo: (...a: unknown[]) => mockUpload(...a),
  startSignupCheckout: (...a: unknown[]) => mockStart(...a),
}));

import { SetupForm } from "../setup-form";

const EMPTY = { firmName: "", advisorName: "", primaryColor: null, logoUrl: null };

const logoFile = () =>
  new File([new Uint8Array([1])], "logo.png", { type: "image/png" });

/** The native colour input, i.e. what the swatch currently holds. */
const chosenColor = () =>
  (screen.getByLabelText("Custom") as HTMLInputElement).value;

beforeEach(() => {
  vi.clearAllMocks();
  mockSave.mockResolvedValue({ ok: true });
  mockStart.mockResolvedValue({ ok: true, url: "https://checkout.stripe.com/c/pay/x" });
  mockUpload.mockResolvedValue({ ok: true, url: "https://blob.example/uploaded.png" });
  // jsdom ships no object-URL store, so the optimistic preview's
  // URL.createObjectURL(file) would throw. The value is opaque to the form.
  URL.createObjectURL = vi.fn(() => "blob:local-preview");
  URL.revokeObjectURL = vi.fn();
});

describe("the setup step", () => {
  it("will not continue without a firm name — nothing can provision without it", () => {
    render(<SetupForm initial={EMPTY} plan="annual" />);
    expect(screen.getByRole("button", { name: /^continue$/i })).toBeDisabled();
  });

  it("continues on the firm name alone, with branding untouched", async () => {
    // Branding is OPTIONAL. If it can ever gate the card, this design has failed.
    render(<SetupForm initial={EMPTY} plan="annual" />);
    await userEvent.type(screen.getByLabelText(/firm name/i), "Acme Wealth");
    expect(screen.getByRole("button", { name: /^continue$/i })).toBeEnabled();
  });

  it("shows the firm name on the report preview as it is typed", async () => {
    // The whole premise: every input has to visibly buy them something.
    render(<SetupForm initial={EMPTY} plan="annual" />);
    await userEvent.type(screen.getByLabelText(/firm name/i), "Acme Wealth");
    expect(await screen.findByTestId("cover-preview")).toHaveTextContent("Acme Wealth");
  });

  it("saves the profile and hands off to Stripe", async () => {
    render(<SetupForm initial={EMPTY} plan="annual" navigate={mockNavigate} />);
    await userEvent.type(screen.getByLabelText(/firm name/i), "Acme Wealth");
    await userEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith(
        // `plan` is asserted here, not just firmName: it is a value this form
        // SUPPLIES, so nothing else in the suite watches it, and objectContaining
        // on firmName alone passes just as happily when plan is missing.
        expect.objectContaining({ firmName: "Acme Wealth", plan: "annual" }),
      ),
    );
    // Where they are SENT is the point of the step, and nothing else watches it:
    // a handler that called startSignupCheckout and then dropped the URL on the
    // floor would satisfy every other assertion in this file.
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/x"),
    );
  });

  it("carries a monthly buyer's plan through to the stash", async () => {
    // The money case. startSignupCheckout prices off PLAN_PRICE_KEY[stash.plan],
    // and coerce() in pending-signup.ts defaults an unwritten plan to "annual" —
    // so a monthly buyer whose plan never leaves this form pays the annual price.
    render(<SetupForm initial={EMPTY} plan="monthly" navigate={mockNavigate} />);
    await userEvent.type(screen.getByLabelText(/firm name/i), "Acme Wealth");
    await userEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({ plan: "monthly" }),
      ),
    );
  });

  it("surfaces a failed upload inline and still lets them pay", async () => {
    mockUpload.mockResolvedValue({ ok: false, error: "Logo must be 2 MB or smaller" });
    render(<SetupForm initial={{ ...EMPTY, firmName: "Acme" }} plan="annual" />);
    await userEvent.upload(screen.getByLabelText(/logo/i), logoFile());
    expect(await screen.findByText(/2 MB or smaller/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^continue$/i })).toBeEnabled();
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
    render(<SetupForm initial={{ ...EMPTY, firmName: "Acme" }} plan="annual" navigate={mockNavigate} />);
    await userEvent.upload(screen.getByLabelText(/logo/i), logoFile());
    await userEvent.click(screen.getByRole("button", { name: /^continue$/i }));

    expect(mockSave).not.toHaveBeenCalled();

    breakUpload(new Error("the network died mid-upload"));
    await waitFor(() => expect(mockStart).toHaveBeenCalled());
  });

  it("submits on Enter, the natural gesture on a two-field page", async () => {
    render(<SetupForm initial={EMPTY} plan="annual" navigate={mockNavigate} />);
    await userEvent.type(screen.getByLabelText(/firm name/i), "Acme Wealth{Enter}");
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({ firmName: "Acme Wealth" }),
      ),
    );
  });

  it("suggests the logo's colour when the buyer has not picked one", async () => {
    // Contract clause 3: colour is DERIVED, not typed. The sampler is injected
    // because jsdom decodes no image — the real one returns a promise that
    // never settles here, which is how the guard below shipped unwatched.
    const suggested = Promise.resolve("#c8283c");
    const derive = vi.fn(() => suggested);
    render(
      <SetupForm
        initial={{ ...EMPTY, firmName: "Acme" }}
        plan="annual"
        deriveColor={derive}
      />,
    );
    expect(chosenColor()).toBe("#0f7d6c"); // the report's honest fallback

    await userEvent.upload(screen.getByLabelText(/logo/i), logoFile());
    await act(async () => {
      await suggested; // the very promise the form chained onto
    });
    expect(chosenColor()).toBe("#c8283c");
  });

  it("never overwrites a colour the returning buyer already chose", async () => {
    // They picked Burgundy, abandoned at the card, signed back in, then
    // uploaded a logo. The suggestion must not quietly replace the colour that
    // ships on every report their clients read.
    const suggested = Promise.resolve("#c8283c");
    const derive = vi.fn(() => suggested);
    render(
      <SetupForm
        initial={{ ...EMPTY, firmName: "Acme", primaryColor: "#7b2d3b" }}
        plan="annual"
        deriveColor={derive}
      />,
    );
    await userEvent.upload(screen.getByLabelText(/logo/i), logoFile());
    await act(async () => {
      await suggested;
    });
    expect(derive).toHaveBeenCalled();
    expect(chosenColor()).toBe("#7b2d3b");
    expect(screen.getByRole("button", { name: "Burgundy" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("hands back the preview's object URL once the upload settles", async () => {
    // The optimistic preview holds a blob in memory. Nothing else in the suite
    // watches it, and a leak is invisible on screen.
    render(
      <SetupForm
        initial={{ ...EMPTY, firmName: "Acme" }}
        plan="annual"
        deriveColor={vi.fn().mockResolvedValue(null)}
      />,
    );
    await userEvent.upload(screen.getByLabelText(/logo/i), logoFile());
    await waitFor(() =>
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-preview"),
    );
  });

  it("keeps showing the stashed logo when a replacement upload fails", async () => {
    // A failed upload leaves the stash holding the old logo — which is what the
    // webhook provisions. Blanking the preview would show them one cover and
    // ship another.
    mockUpload.mockResolvedValue({ ok: false, error: "Logo must be 2 MB or smaller" });
    render(
      <SetupForm
        initial={{ ...EMPTY, firmName: "Acme", logoUrl: "https://blob.example/logo.png" }}
        plan="annual"
      />,
    );
    await userEvent.upload(screen.getByLabelText(/logo/i), logoFile());
    expect(await screen.findByText(/2 MB or smaller/i)).toBeInTheDocument();
    expect(screen.getByAltText(/your logo/i)).toHaveAttribute(
      "src",
      "https://blob.example/logo.png",
    );
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
