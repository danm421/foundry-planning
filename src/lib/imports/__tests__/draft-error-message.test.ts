import { describe, it, expect } from "vitest";
import { draftErrorMessage } from "../draft-error-message";

describe("draftErrorMessage", () => {
  it("prefers returned warnings when present", () => {
    expect(
      draftErrorMessage({ warnings: ["Scanned image — upload a text PDF."] }, 1),
    ).toBe("Scanned image — upload a text PDF.");
  });

  it("falls back to the generic failure message", () => {
    expect(draftErrorMessage({ failed: 2 }, 3)).toMatch(/All 2 file\(s\) failed/);
  });

  it("uses fileCount when failed is absent", () => {
    expect(draftErrorMessage({}, 4)).toMatch(/All 4 file\(s\) failed/);
  });
});
