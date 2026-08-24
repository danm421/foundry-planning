// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * A fresh copy of the store per case. The cache that makes `getSnapshot`
 * stable lives at module scope, so re-importing is the only way to ask what a
 * new page load would read — and it keeps the reset out of the shipped module.
 */
async function freshProbe() {
  vi.resetModules();
  const { useDollarBasis } = await import("../dollar-basis-store");
  return function Probe() {
    const [basis, setBasis] = useDollarBasis();
    return (
      <button type="button" onClick={() => setBasis(basis === "today" ? "nominal" : "today")}>
        {basis}
      </button>
    );
  };
}

describe("useDollarBasis", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to today's dollars", async () => {
    const Probe = await freshProbe();
    render(<Probe />);
    expect(screen.getByRole("button")).toHaveTextContent("today");
  });

  it("writes the choice to localStorage", async () => {
    const Probe = await freshProbe();
    render(<Probe />);
    await userEvent.click(screen.getByRole("button"));
    expect(window.localStorage.getItem("foundry:solver:dollarBasis")).toBe("nominal");
  });

  it("shows the new choice straight away, without waiting for a reload", async () => {
    const Probe = await freshProbe();
    render(<Probe />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveTextContent("nominal");
  });

  it("reads a stored choice back on a fresh mount", async () => {
    window.localStorage.setItem("foundry:solver:dollarBasis", "nominal");
    const Probe = await freshProbe();
    render(<Probe />);
    expect(screen.getByRole("button")).toHaveTextContent("nominal");
  });

  it("treats an unrecognised stored value as the default", async () => {
    window.localStorage.setItem("foundry:solver:dollarBasis", "banana");
    const Probe = await freshProbe();
    render(<Probe />);
    expect(screen.getByRole("button")).toHaveTextContent("today");
  });
});
