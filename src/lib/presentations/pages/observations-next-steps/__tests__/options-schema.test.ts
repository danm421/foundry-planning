import { describe, it, expect } from "vitest";
import {
  observationsPageOptionsSchema,
  OBSERVATIONS_PAGE_OPTIONS_DEFAULT,
  isObservationsPageUnconfigured,
} from "../options-schema";
import { summarizeObservationsOptions } from "../summarize-options";

describe("observationsPageOptionsSchema", () => {
  it("defaults both sections on", () => {
    expect(observationsPageOptionsSchema.parse({})).toEqual(OBSERVATIONS_PAGE_OPTIONS_DEFAULT);
    expect(OBSERVATIONS_PAGE_OPTIONS_DEFAULT.showObservations).toBe(true);
    expect(OBSERVATIONS_PAGE_OPTIONS_DEFAULT.showNextSteps).toBe(true);
  });

  // Every template and localStorage draft saved before this change carries
  // `include`; each must load with the same sections it printed before.
  it.each([
    ["both", true, true],
    ["observations", true, false],
    ["nextSteps", false, true],
  ])("migrates legacy include: %s", (include, showObservations, showNextSteps) => {
    const parsed = observationsPageOptionsSchema.parse({ include, topics: ["tax"], intro: "Hi" });
    expect(parsed).toEqual({
      ...OBSERVATIONS_PAGE_OPTIONS_DEFAULT,
      showObservations,
      showNextSteps,
      topics: ["tax"],
      intro: "Hi",
    });
    expect("include" in parsed).toBe(false);
  });

  it("leaves the booleans alone when they are present beside a stale include", () => {
    const parsed = observationsPageOptionsSchema.parse({
      include: "nextSteps",
      showObservations: true,
      showNextSteps: false,
    });
    expect(parsed.showObservations).toBe(true);
    expect(parsed.showNextSteps).toBe(false);
  });
});

describe("isObservationsPageUnconfigured", () => {
  it("is true only when both sections are off", () => {
    expect(isObservationsPageUnconfigured(OBSERVATIONS_PAGE_OPTIONS_DEFAULT)).toBe(false);
    expect(
      isObservationsPageUnconfigured({ ...OBSERVATIONS_PAGE_OPTIONS_DEFAULT, showObservations: false }),
    ).toBe(false);
    expect(
      isObservationsPageUnconfigured({
        ...OBSERVATIONS_PAGE_OPTIONS_DEFAULT,
        showObservations: false,
        showNextSteps: false,
      }),
    ).toBe(true);
  });
});

describe("summarizeObservationsOptions", () => {
  it("names the sections and the topic count", () => {
    expect(summarizeObservationsOptions(OBSERVATIONS_PAGE_OPTIONS_DEFAULT)).toBe(
      "Observations · Next Steps · all topics",
    );
    expect(
      summarizeObservationsOptions({
        ...OBSERVATIONS_PAGE_OPTIONS_DEFAULT,
        showObservations: false,
        topics: ["tax", "estate"],
      }),
    ).toBe("Next Steps only · 2 topics");
    expect(
      summarizeObservationsOptions({
        ...OBSERVATIONS_PAGE_OPTIONS_DEFAULT,
        showNextSteps: false,
        topics: ["tax"],
      }),
    ).toBe("Observations only · 1 topic");
    expect(
      summarizeObservationsOptions({
        ...OBSERVATIONS_PAGE_OPTIONS_DEFAULT,
        showObservations: false,
        showNextSteps: false,
      }),
    ).toBe("Nothing selected · all topics");
  });
});
