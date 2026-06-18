import { describe, it, expect } from "vitest";
import { parseApprovalInterrupt, parseResumeDecisions } from "../interrupts";

describe("interrupt schemas", () => {
  it("parses a well-formed approval interrupt", () => {
    const v = {
      type: "approval_required",
      previews: [{ summary: "Add expense", name: "add_expense", details: ["$1,200/yr"] }],
      calls: [{ id: "t1", name: "add_expense", args: { annualAmount: 1200 } }],
    };
    expect(parseApprovalInterrupt(v).calls[0].name).toBe("add_expense");
  });

  it("rejects a malformed resume payload", () => {
    expect(() => parseResumeDecisions({ decisions: { t1: "maybe" } })).toThrow();
  });

  it("accepts a valid resume payload", () => {
    expect(parseResumeDecisions({ decisions: { t1: "confirm", t2: "reject" } }).decisions.t1).toBe("confirm");
  });
});
