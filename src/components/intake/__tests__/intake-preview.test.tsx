// @vitest-environment jsdom
/**
 * Tests for the advisor-facing IntakePreview wrapper.
 * Mocks IntakeWizard to expose controlled onChange/onSubmit triggers, and asserts
 * the preview does NO network I/O: neither editing nor submitting may call fetch.
 * Submitting reveals the shared thank-you screen so the advisor sees the end state.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ─── Mock IntakeWizard ────────────────────────────────────────────────────────
// Exposes controlled buttons that invoke onChange / onSubmit so the test can
// exercise the wrapper's side effects without a full wizard render.

vi.mock("@/components/intake/intake-wizard", () => ({
  IntakeWizard: ({
    onSubmit,
    onChange,
    mode,
  }: {
    onSubmit: () => Promise<void>;
    onChange: (d: unknown) => void;
    value: unknown;
    mode: string;
  }) => (
    <div data-testid="wizard" data-mode={mode}>
      <button onClick={() => onChange({ family: { primary: { firstName: "Test" } } })}>
        change
      </button>
      <button onClick={() => void onSubmit()}>submit</button>
    </div>
  ),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { IntakePreview } from "../intake-preview";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("IntakePreview", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = vi.fn();
  });

  it("renders the wizard in blank mode with a non-live preview banner", () => {
    render(<IntakePreview />);

    expect(screen.getByTestId("wizard")).toHaveAttribute("data-mode", "blank");
    expect(screen.getByText(/nothing is saved or sent/i)).toBeInTheDocument();
  });

  it("does not call fetch when the form changes", async () => {
    const user = userEvent.setup();
    render(<IntakePreview />);

    await user.click(screen.getByRole("button", { name: "change" }));

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not call fetch on submit and reveals the thank-you screen", async () => {
    const user = userEvent.setup();
    render(<IntakePreview />);

    await user.click(screen.getByRole("button", { name: "submit" }));

    expect(await screen.findByRole("heading", { name: /thank you/i })).toBeInTheDocument();
    expect(screen.queryByTestId("wizard")).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("keeps the preview banner visible on the thank-you screen", async () => {
    const user = userEvent.setup();
    render(<IntakePreview />);

    await user.click(screen.getByRole("button", { name: "submit" }));

    expect(await screen.findByRole("heading", { name: /thank you/i })).toBeInTheDocument();
    expect(screen.getByText(/nothing is saved or sent/i)).toBeInTheDocument();
  });
});
