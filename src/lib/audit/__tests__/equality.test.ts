import { describe, it, expect } from "vitest";
import { isAuditValueEqual } from "../equality";

describe("isAuditValueEqual", () => {
  it("returns true for identical primitives", () => {
    expect(isAuditValueEqual(5, 5)).toBe(true);
    expect(isAuditValueEqual("a", "a")).toBe(true);
    expect(isAuditValueEqual(true, true)).toBe(true);
    expect(isAuditValueEqual(null, null)).toBe(true);
  });

  it("returns false for differing primitives", () => {
    expect(isAuditValueEqual(5, 6)).toBe(false);
    expect(isAuditValueEqual("a", "b")).toBe(false);
    expect(isAuditValueEqual(null, 0)).toBe(false);
    expect(isAuditValueEqual(true, false)).toBe(false);
  });

  it("compares ReferenceValue by id and display", () => {
    expect(
      isAuditValueEqual(
        { id: "u1", display: "Jane" },
        { id: "u1", display: "Jane" },
      ),
    ).toBe(true);
    expect(
      isAuditValueEqual(
        { id: "u1", display: "Jane" },
        { id: "u1", display: "Jane Smith" },
      ),
    ).toBe(false);
    expect(
      isAuditValueEqual(
        { id: "u1", display: "Jane" },
        { id: "u2", display: "Jane" },
      ),
    ).toBe(false);
  });

  it("compares arrays element-wise", () => {
    expect(isAuditValueEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(isAuditValueEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(isAuditValueEqual([1, 2, 3], [1, 3, 2])).toBe(false);
  });

  it("treats null and undefined-shaped reference as not equal", () => {
    expect(isAuditValueEqual(null, { id: "x", display: "y" })).toBe(false);
    expect(isAuditValueEqual({ id: "x", display: "y" }, null)).toBe(false);
  });
});
