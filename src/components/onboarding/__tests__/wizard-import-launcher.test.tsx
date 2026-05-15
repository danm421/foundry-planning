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

  it("renders the trigger button and no drawer initially", () => {
    render(<WizardImportLauncher {...baseProps} />);
    expect(
      screen.getByRole("button", { name: /import from document/i }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("drawer")).not.toBeInTheDocument();
  });

  it("opens the drawer on click and closes it via onClose", () => {
    render(<WizardImportLauncher {...baseProps} />);
    fireEvent.click(
      screen.getByRole("button", { name: /import from document/i }),
    );
    expect(screen.getByTestId("drawer")).toBeInTheDocument();
    fireEvent.click(screen.getByText("close"));
    expect(screen.queryByTestId("drawer")).not.toBeInTheDocument();
  });
});
