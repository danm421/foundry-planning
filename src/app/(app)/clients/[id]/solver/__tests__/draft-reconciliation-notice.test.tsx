// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DraftReconciliationNotice } from "../draft-reconciliation-notice";

describe("DraftReconciliationNotice", () => {
  it("shows the notice and dismisses it", () => {
    const onDismiss = vi.fn();
    render(
      <DraftReconciliationNotice
        notice="Your unsaved Solver changes to Salary were replaced by this edit."
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your unsaved Solver changes to Salary were replaced by this edit.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders nothing without a notice", () => {
    const { container } = render(<DraftReconciliationNotice notice={null} onDismiss={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
