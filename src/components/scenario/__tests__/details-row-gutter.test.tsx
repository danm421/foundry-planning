// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DetailsRowGutter } from "@/components/scenario/details-row-gutter";

describe("DetailsRowGutter", () => {
  let onRevert: () => void;
  beforeEach(() => {
    onRevert = vi.fn();
  });

  it("renders empty placeholder for unchanged", () => {
    const { container } = render(
      <DetailsRowGutter diff={{ kind: "unchanged" }} onRevert={onRevert} />,
    );
    expect(container.querySelector("[aria-hidden]")).toBeTruthy();
  });

  it("renders + for add", () => {
    render(<DetailsRowGutter diff={{ kind: "add" }} onRevert={onRevert} />);
    expect(screen.getByLabelText("added")).toHaveTextContent("+");
  });

  it("renders − for remove", () => {
    render(<DetailsRowGutter diff={{ kind: "remove" }} onRevert={onRevert} />);
    expect(screen.getByLabelText("removed")).toHaveTextContent("−");
  });

  it("renders Δ for edit", () => {
    render(
      <DetailsRowGutter
        diff={{ kind: "edit", fields: [{ field: "amount", from: 100, to: 200 }] }}
        onRevert={onRevert}
      />,
    );
    expect(screen.getByLabelText("edited")).toHaveTextContent("Δ");
  });

  it("hover shows tooltip with field diffs and Revert button (edit)", () => {
    render(
      <DetailsRowGutter
        diff={{ kind: "edit", fields: [{ field: "amount", from: 100, to: 200 }] }}
        onRevert={onRevert}
      />,
    );
    fireEvent.mouseEnter(screen.getByLabelText("edited").parentElement!);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(screen.getByText(/amount/)).toBeInTheDocument();
    expect(screen.getByText(/Base 100/)).toBeInTheDocument();
    expect(screen.getByText(/Scenario 200/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Revert/ })).toBeInTheDocument();
  });

  it("clicking Revert calls onRevert", () => {
    render(<DetailsRowGutter diff={{ kind: "add" }} onRevert={onRevert} />);
    const span = screen.getByLabelText("added").parentElement!;
    fireEvent.mouseEnter(span);
    fireEvent.click(screen.getByRole("button", { name: /Revert/ }));
    expect(onRevert).toHaveBeenCalledTimes(1);
  });

  it("hides tooltip on mouse leave", () => {
    render(
      <DetailsRowGutter
        diff={{ kind: "edit", fields: [{ field: "amount", from: 1, to: 2 }] }}
        onRevert={onRevert}
      />,
    );
    const span = screen.getByLabelText("edited").parentElement!;
    fireEvent.mouseEnter(span);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.mouseLeave(span);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
