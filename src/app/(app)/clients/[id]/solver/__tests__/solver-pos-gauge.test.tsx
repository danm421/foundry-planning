// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SolverPosGauge } from "../solver-pos-gauge";

describe("SolverPosGauge — Recalculate overlay", () => {
  it("shows no overlay button when ready", () => {
    render(
      <SolverPosGauge state="ready" successPct={0.88} onRegenerate={vi.fn()} />,
    );
    expect(screen.getByText("88%")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /recalculate/i })).toBeNull();
  });

  it("shows the overlay button when stale and calls onRegenerate on click", () => {
    const onRegenerate = vi.fn();
    render(
      <SolverPosGauge state="stale" successPct={0.88} onRegenerate={onRegenerate} />,
    );
    // last value still rendered (dimmed) behind the overlay
    expect(screen.getByText("88%")).toBeTruthy();
    const btn = screen.getByRole("button", { name: /recalculate/i });
    fireEvent.click(btn);
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it("shows the overlay button on error (acts as retry)", () => {
    render(
      <SolverPosGauge state="error" successPct={null} onRegenerate={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /recalculate/i })).toBeTruthy();
  });

  it("disables the overlay button while a solve is active", () => {
    render(
      <SolverPosGauge
        state="stale"
        successPct={0.88}
        onRegenerate={vi.fn()}
        solveActive
      />,
    );
    expect(screen.getByRole("button", { name: /recalculate/i })).toBeDisabled();
  });

  it("never shows an overlay without an onRegenerate handler (base column)", () => {
    render(<SolverPosGauge state="stale" successPct={0.88} />);
    expect(screen.queryByRole("button", { name: /recalculate/i })).toBeNull();
  });
});
