import { describe, it, expect } from "vitest";
import { buildObservations } from "../observations";
import { params2025, retireeMfj } from "./fixtures";

describe("buildObservations", () => {
  it("returns ordered, non-null observations for the retiree persona", () => {
    const obs = buildObservations({
      facts: retireeMfj(), prior: null, params: params2025, irmaaParams: params2025,
      primaryAge: 72, spouseAge: 72,
    });
    const ids = obs.map((o) => o.id);
    expect(ids[0]).toBe("bracket-position");
    expect(ids).toContain("roth-headroom");
    expect(ids).toContain("qcd");
    expect(ids).toContain("irmaa-cliff");
    expect(ids).toContain("safe-harbor");
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
  });
});
