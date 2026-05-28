// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReportCommandPalette, AddPageButton } from "../report-command-palette";

function setup(overrides = {}) {
  const onAdd = vi.fn();
  const onClose = vi.fn();
  render(
    <ReportCommandPalette
      open
      counts={{}}
      recents={[]}
      onAdd={onAdd}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onAdd, onClose };
}

describe("ReportCommandPalette", () => {
  it("filters rows as you type", () => {
    setup();
    fireEvent.change(screen.getByPlaceholderText(/search reports/i), {
      target: { value: "income" },
    });
    expect(screen.getByText("Cash Flow — Income")).toBeInTheDocument();
    expect(screen.queryByText("Cover Sheet")).not.toBeInTheDocument();
  });

  it("Enter adds the highlighted report and keeps the palette open", () => {
    const { onAdd, onClose } = setup();
    const input = screen.getByPlaceholderText(/search reports/i);
    fireEvent.change(input, { target: { value: "income" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith("cashFlowIncome");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Cmd+Enter adds and closes", () => {
    const { onAdd, onClose } = setup();
    const input = screen.getByPlaceholderText(/search reports/i);
    fireEvent.change(input, { target: { value: "income" } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    expect(onAdd).toHaveBeenCalledWith("cashFlowIncome");
    expect(onClose).toHaveBeenCalled();
  });

  it("renders an Added ×N badge from counts", () => {
    setup({ counts: { cashFlow: 2 } });
    expect(screen.getByText("Added ×2")).toBeInTheDocument();
  });

  it("Escape closes the palette", () => {
    const { onClose } = setup();
    fireEvent.keyDown(screen.getByPlaceholderText(/search reports/i), {
      key: "Escape",
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking a row adds it", () => {
    const { onAdd } = setup();
    fireEvent.click(screen.getByText("Cover Sheet"));
    expect(onAdd).toHaveBeenCalledWith("cover");
  });

  it("shows an empty state when nothing matches", () => {
    setup();
    fireEvent.change(screen.getByPlaceholderText(/search reports/i), {
      target: { value: "zzzznotareport" },
    });
    expect(screen.getByText(/no reports match/i)).toBeInTheDocument();
  });
});

describe("AddPageButton", () => {
  it("resets the search query when the palette is reopened", () => {
    render(<AddPageButton counts={{}} onAdd={vi.fn()} />);
    // open
    fireEvent.click(screen.getByRole("button", { name: /add page/i }));
    const input = () => screen.getByPlaceholderText(/search reports/i);
    fireEvent.change(input(), { target: { value: "income" } });
    expect(input()).toHaveValue("income");
    // close via Escape
    fireEvent.keyDown(input(), { key: "Escape" });
    // reopen
    fireEvent.click(screen.getByRole("button", { name: /add page/i }));
    expect(input()).toHaveValue("");
  });
});
