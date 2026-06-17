import { describe, it, expect } from "vitest";
import { ProjectionInputError } from "@/lib/projection/load-client-data";
import { safeForgeErrorMessage } from "../safe-error";

describe("safeForgeErrorMessage", () => {
  it("maps a ProjectionInputError to a safe generic string, not its raw message", () => {
    const raw = "Client a1b2c3d4-1111-2222-3333-444455556666 has no base case scenario";
    const out = safeForgeErrorMessage(new ProjectionInputError(raw));
    expect(out).not.toBe(raw);
    expect(out).not.toContain("a1b2c3d4");
    expect(out.length).toBeGreaterThan(0);
  });

  it("does not leak a UUID embedded in a generic Error message", () => {
    const out = safeForgeErrorMessage(new Error("boom 1a2b3c4d-1111-2222-3333-444455556666 internal"));
    expect(out).not.toContain("1a2b3c4d");
    expect(out).not.toContain("1a2b3c4d-1111-2222-3333-444455556666");
    expect(out.length).toBeGreaterThan(0);
  });

  it("returns the fallback without throwing for a non-Error value (e.g. a thrown string)", () => {
    expect(() => safeForgeErrorMessage("some thrown string")).not.toThrow();
    const out = safeForgeErrorMessage("some thrown string");
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });
});
