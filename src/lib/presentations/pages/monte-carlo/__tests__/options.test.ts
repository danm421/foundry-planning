import { describe, it, expect } from "vitest";
import {
  monteCarloOptionsSchema,
  MONTE_CARLO_OPTIONS_DEFAULT,
} from "../options-schema";
import { summarizeMonteCarloOptions } from "../summarize-options";

describe("monte carlo options", () => {
  it("defaults to the fan chart highlight", () => {
    expect(MONTE_CARLO_OPTIONS_DEFAULT).toEqual({ highlight: "fan" });
    expect(monteCarloOptionsSchema.parse(MONTE_CARLO_OPTIONS_DEFAULT)).toEqual({
      highlight: "fan",
    });
  });

  it("rejects an unknown highlight", () => {
    expect(() => monteCarloOptionsSchema.parse({ highlight: "nope" })).toThrow();
  });

  it("summarizes each highlight", () => {
    expect(summarizeMonteCarloOptions({ highlight: "fan" })).toBe("Highlight: Fan chart");
    expect(summarizeMonteCarloOptions({ highlight: "histogram" })).toBe(
      "Highlight: Ending distribution",
    );
    expect(summarizeMonteCarloOptions({ highlight: "longevity" })).toBe(
      "Highlight: Success over time",
    );
  });
});
