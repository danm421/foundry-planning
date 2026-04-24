// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AddEntityMenu from "../add-entity-menu";

describe("AddEntityMenu", () => {
  it("renders a closed menu button", () => {
    render(<AddEntityMenu onPick={() => {}} />);
    expect(screen.getByRole("button", { name: /add entity/i })).toBeDefined();
    expect(screen.queryByText(/^Trust$/)).toBeNull();
    expect(screen.queryByText(/^Business$/)).toBeNull();
  });

  it("opens menu on click and shows two options", () => {
    render(<AddEntityMenu onPick={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /add entity/i }));
    expect(screen.getByText("Trust")).toBeDefined();
    expect(screen.getByText("Business")).toBeDefined();
  });

  it("calls onPick('trust') when Trust is clicked", () => {
    const onPick = vi.fn();
    render(<AddEntityMenu onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: /add entity/i }));
    fireEvent.click(screen.getByText("Trust"));
    expect(onPick).toHaveBeenCalledWith("trust");
  });

  it("calls onPick('business') when Business is clicked", () => {
    const onPick = vi.fn();
    render(<AddEntityMenu onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: /add entity/i }));
    fireEvent.click(screen.getByText("Business"));
    expect(onPick).toHaveBeenCalledWith("business");
  });

  it("closes menu after a pick", () => {
    render(<AddEntityMenu onPick={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /add entity/i }));
    fireEvent.click(screen.getByText("Trust"));
    expect(screen.queryByText(/^Business$/)).toBeNull();
  });
});
