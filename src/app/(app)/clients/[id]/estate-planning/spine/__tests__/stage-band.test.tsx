// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StageBand } from "../stage-band";

describe("StageBand", () => {
  it("disables the button when no expansion prop is provided", () => {
    render(<StageBand kind="tax" label="Taxes" value={-100} />);
    const btn = screen.getByRole("button", { name: /Taxes/ });
    expect(btn).toBeDisabled();
    expect(btn).not.toHaveAttribute("aria-expanded");
  });

  it("toggles expansion content on click", async () => {
    const user = userEvent.setup();
    render(<StageBand kind="tax" label="Taxes" value={-100} expansion={<div>BREAKDOWN</div>} />);

    expect(screen.queryByText("BREAKDOWN")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Taxes/ }));
    expect(screen.getByText("BREAKDOWN")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Taxes/ }));
    expect(screen.queryByText("BREAKDOWN")).not.toBeInTheDocument();
  });

  it("renders defaultExpanded content immediately", () => {
    render(
      <StageBand
        kind="trusts"
        label="To Trusts"
        value={50_000}
        expansion={<div>OPEN BY DEFAULT</div>}
        defaultExpanded
      />,
    );
    expect(screen.getByText("OPEN BY DEFAULT")).toBeInTheDocument();
  });
});
