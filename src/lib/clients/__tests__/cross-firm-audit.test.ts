import { describe, it, expect } from "vitest";
import { crossFirmAuditMeta } from "../cross-firm-audit";

describe("crossFirmAuditMeta", () => {
  it("shared access yields the flag + actorFirmId", () => {
    const result = crossFirmAuditMeta(
      { access: "shared" },
      "org_caller",
      { firstName: "A" }
    );
    expect(result).toEqual({
      firstName: "A",
      crossFirmActor: true,
      actorFirmId: "org_caller",
    });
  });

  it("shared with null callerOrgId", () => {
    const result = crossFirmAuditMeta({ access: "shared" }, null);
    expect(result).toEqual({
      crossFirmActor: true,
      actorFirmId: null,
    });
  });

  it("own access leaves metadata untouched", () => {
    const result = crossFirmAuditMeta(
      { access: "own" },
      "org_caller",
      { firstName: "A" }
    );
    expect(result).toEqual({ firstName: "A" });
  });

  it("own access with no base returns empty object", () => {
    const result = crossFirmAuditMeta({ access: "own" }, "org_caller");
    expect(result).toEqual({});
  });
});
