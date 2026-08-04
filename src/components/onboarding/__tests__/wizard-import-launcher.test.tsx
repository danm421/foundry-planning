// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import WizardImportLauncher from "../wizard-import-launcher";

// The drawer pulls in fetch-heavy children — stub it so this test stays a
// pure launcher test (drawer behavior is covered by manual verification).
vi.mock("../wizard-import-drawer", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="drawer">
      <button onClick={onClose}>close</button>
    </div>
  ),
}));

describe("WizardImportLauncher", () => {
  const baseProps = {
    clientId: "c1",
    step: "accounts" as const,
    baseScenarioId: "s1",
    activeImportId: null,
  };

  it("presents upload and manual entry as peer options", () => {
    render(<WizardImportLauncher {...baseProps} />);
    expect(screen.getByRole("button", { name: /upload a statement/i })).toBeTruthy();
    expect(screen.getByText(/or add them manually below/i)).toBeTruthy();
  });

  it("keeps the forge anchor for the first-run tour", () => {
    const { container } = render(<WizardImportLauncher {...baseProps} />);
    expect(container.querySelector('[data-forge-anchor="wizard-import-launcher"]')).toBeTruthy();
  });

  it("does not mount the drawer until the upload option is chosen", () => {
    render(<WizardImportLauncher {...baseProps} />);
    expect(screen.queryByTestId("drawer")).toBeNull();
  });

  it("opens the drawer on click and closes it via onClose", () => {
    render(<WizardImportLauncher {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /upload a statement/i }));
    expect(screen.getByTestId("drawer")).toBeInTheDocument();
    fireEvent.click(screen.getByText("close"));
    expect(screen.queryByTestId("drawer")).not.toBeInTheDocument();
  });
});
