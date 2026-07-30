// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InlineYearCell from "../inline-year-cell";
import type { ClientMilestones } from "@/lib/milestones";

const MILESTONES: ClientMilestones = {
  planStart: 2026,
  planEnd: 2066,
  clientRetirement: 2035,
  clientEnd: 2060,
  spouseRetirement: 2037,
  spouseEnd: 2064,
};

function setup(overrides: Partial<React.ComponentProps<typeof InlineYearCell>> = {}) {
  const onSave = vi.fn().mockResolvedValue(true);
  render(
    <InlineYearCell
      year={2035}
      yearRef="client_retirement"
      milestones={MILESTONES}
      position="start"
      label="start year for Salary"
      canEdit
      onSave={onSave}
      {...overrides}
    />,
  );
  return { onSave };
}

describe("InlineYearCell", () => {
  it("shows the anchor name beside the year when anchored", () => {
    setup();
    expect(screen.getByRole("button", { name: "Change start year for Salary" }))
      .toHaveTextContent("Client Retirement (2035)");
  });

  it("shows a bare year when not anchored", () => {
    setup({ year: 2040, yearRef: null });
    expect(screen.getByRole("button")).toHaveTextContent("2040");
    expect(screen.getByRole("button")).not.toHaveTextContent("(");
  });

  it("saves the resolved year and the ref when a milestone is picked", async () => {
    const user = userEvent.setup();
    const { onSave } = setup({ year: 2026, yearRef: "plan_start" });
    await user.click(screen.getByRole("button"));
    await user.selectOptions(screen.getByRole("combobox"), "client_retirement");
    expect(onSave).toHaveBeenCalledWith(2035, "client_retirement");
  });

  it("resolves an end-position transition ref to year - 1", async () => {
    const user = userEvent.setup();
    const { onSave } = setup({ year: 2060, yearRef: null, position: "end", label: "end year for Salary" });
    await user.click(screen.getByRole("button"));
    await user.selectOptions(screen.getByRole("combobox"), "client_retirement");
    // The stream must stop the year BEFORE retirement, not overlap it.
    expect(onSave).toHaveBeenCalledWith(2034, "client_retirement");
  });

  it("arms a number input when Custom year is picked, and saves ref null", async () => {
    const user = userEvent.setup();
    const { onSave } = setup();
    await user.click(screen.getByRole("button"));
    await user.selectOptions(screen.getByRole("combobox"), "__custom__");
    // Picking Custom must NOT save on its own — the write lands on commit.
    expect(onSave).not.toHaveBeenCalled();
    // Arming yields InlineAmount's trigger, not an open input — same two-step
    // as the growth cell's Custom %, see growth-rate-cell.test.tsx.
    await user.click(screen.getByRole("button", { name: "Edit year for start year for Salary" }));
    const input = screen.getByRole("textbox", { name: "Year for start year for Salary" });
    await user.clear(input);
    await user.type(input, "2042");
    await user.keyboard("{Enter}");
    expect(onSave).toHaveBeenCalledWith(2042, null);
  });

  it("omits SS refs unless showSSRefs is set", async () => {
    const user = userEvent.setup();
    setup({ milestones: { ...MILESTONES, clientSS62: 2032, clientSSFRA: 2037, clientSS70: 2040 } });
    await user.click(screen.getByRole("button"));
    const values = [...screen.getByRole("combobox").querySelectorAll("option")].map((o) => o.value);
    expect(values).not.toContain("client_ss_62");
  });

  it("includes SS refs when showSSRefs is set", async () => {
    const user = userEvent.setup();
    setup({
      showSSRefs: true,
      milestones: { ...MILESTONES, clientSS62: 2032, clientSSFRA: 2037, clientSS70: 2040 },
    });
    await user.click(screen.getByRole("button"));
    const values = [...screen.getByRole("combobox").querySelectorAll("option")].map((o) => o.value);
    expect(values).toContain("client_ss_62");
  });

  it("renders plain text when canEdit is false", () => {
    setup({ canEdit: false });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Client Retirement (2035)")).toBeInTheDocument();
  });
});
