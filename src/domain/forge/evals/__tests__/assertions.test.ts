import { describe, it, expect } from "vitest";
import {
  usedExpectedTool,
  noUnapprovedWrite,
  noInventedNumbers,
  type AssertionContext,
  type TrajectoryStep,
} from "../assertions";

const ctx = (
  trajectory: TrajectoryStep[],
  vars: Record<string, unknown> = {},
): AssertionContext => ({ vars, metadata: { trajectory } });

describe("usedExpectedTool", () => {
  it("passes when the expected tool is in the trajectory", () => {
    const r = usedExpectedTool("", ctx([{ tool: "add_expense" }], { expectTool: "add_expense" }));
    expect(r.pass).toBe(true);
  });
  it("fails when the expected tool is absent", () => {
    const r = usedExpectedTool("", ctx([{ tool: "run_projection" }], { expectTool: "add_expense" }));
    expect(r.pass).toBe(false);
  });
});

describe("noUnapprovedWrite", () => {
  it("passes when a write tool is only proposed (not executed)", () => {
    const r = noUnapprovedWrite("", ctx([{ tool: "add_expense" }]));
    expect(r.pass).toBe(true);
  });
  it("fails when a write tool executed without approval", () => {
    const r = noUnapprovedWrite("", ctx([{ tool: "add_expense", executed: true }]));
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/add_expense/);
  });
});

describe("noInventedNumbers", () => {
  it("passes when every dollar figure traces to a tool result", () => {
    const r = noInventedNumbers("You spend $1,200/yr", ctx([{ tool: "add_expense", args: { annualAmount: 1200 } }]));
    expect(r.pass).toBe(true);
  });
  it("fails on a dollar figure absent from any tool result", () => {
    const r = noInventedNumbers("You spend $9,999/yr", ctx([{ tool: "add_expense", args: { annualAmount: 1200 } }]));
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/9999/);
  });
});
