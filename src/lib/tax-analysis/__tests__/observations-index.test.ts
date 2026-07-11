import { describe, it, expect } from "vitest";
import { buildObservations } from "../observations";
import { runCalc } from "../adapter";
import { buildBracketMap } from "../bracket-map";
import { params2025, retireeMfj } from "./fixtures";

describe("buildObservations", () => {
  it("returns ordered, non-null observations for the retiree persona", () => {
    const facts = retireeMfj();
    const primaryAge = 72;
    const spouseAge = 72;
    const obs = buildObservations({
      facts, prior: null, params: params2025, irmaaParams: params2025,
      primaryAge, spouseAge,
      calc: runCalc(facts, { taxParams: params2025, primaryAge, spouseAge }),
      bracketMap: buildBracketMap(facts, params2025),
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
