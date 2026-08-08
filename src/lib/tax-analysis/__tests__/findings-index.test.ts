import { describe, it, expect } from "vitest";
import { buildFindings } from "../findings";
import { retireeMfj, findingCtx } from "./fixtures";

describe("buildFindings", () => {
  it("returns ordered, non-null findings for the retiree persona", () => {
    const findings = buildFindings(findingCtx(retireeMfj(), { primaryAge: 72, spouseAge: 72 }));
    const ids = findings.map((f) => f.id);
    expect(ids[0]).toBe("bracket-position");
    expect(ids).toContain("roth-headroom");
    expect(ids).toContain("qcd");
    expect(ids).toContain("irmaa-cliff");
    expect(ids).toContain("safe-harbor");
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
  });
});
