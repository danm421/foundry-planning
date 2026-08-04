// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EmailPrompt from "../email-prompt";
import { dismissEmailPromptAction } from "@/app/(app)/alerts/actions";

vi.mock("@/app/(app)/alerts/actions", () => ({
  dismissEmailPromptAction: vi.fn(),
}));

describe("EmailPrompt", () => {
  // The prompt exists because email is off for all eighteen categories and the
  // Settings tab is the only place to change that. A link back to the bare
  // inbox lands on the page the advisor is already looking at.
  it("points at the Settings tab, not the bare inbox", () => {
    render(<EmailPrompt />);
    expect(
      // Exact name, not a substring: the trailing arrow is decorative and
      // carries aria-hidden, so it must not reach the accessible name.
      screen.getByRole("link", { name: "Choose what gets emailed" }),
    ).toHaveAttribute("href", "/alerts?tab=settings");
  });

  it("dismisses by submitting a form wired to the dismiss action", async () => {
    const user = userEvent.setup();
    render(<EmailPrompt />);

    const dismiss = screen.getByRole("button", { name: /no thanks/i });
    // A `type="button"` here, or a control outside the form, silently does
    // nothing — the dismissal has to post so it survives a reload.
    expect(dismiss).toHaveAttribute("type", "submit");
    expect(dismiss.closest("form")).not.toBeNull();

    await user.click(dismiss);
    // Binds the form to THIS action: a form wired to anything else still
    // renders a submit button inside a form and would pass the asserts above.
    expect(dismissEmailPromptAction).toHaveBeenCalledTimes(1);
  });
});
