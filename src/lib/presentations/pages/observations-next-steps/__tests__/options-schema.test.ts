import { describe, it, expect } from "vitest";
import {
  observationsPageOptionsSchema,
  OBSERVATIONS_PAGE_OPTIONS_DEFAULT,
  isObservationsPageUnconfigured,
  type ObservationsPageOptions,
} from "../options-schema";
import { summarizeObservationsOptions } from "../summarize-options";

// A deck saved before this task shipped, restored exactly as
// `use-launcher-draft.ts`'s `readDraft` and `selected-page-row.tsx` hand it
// over: no `optionsSchema.parse` in between, so neither boolean exists. Cast
// the same way those real call sites do (`options as never`) — the point of
// this fixture is that TypeScript's static type is a fiction here.
const RAW_LEGACY_BLOB = {
  include: "both",
  topics: [],
  includeCompleted: false,
  showOwnerAndDate: true,
  intro: "",
} as unknown as ObservationsPageOptions;

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

  // The launcher's Generate guard reads this straight off a restored draft or
  // template row — neither passes through `optionsSchema.parse` first (see
  // `resolveObservationsPageOptions`'s doc comment in options-schema.ts). A
  // deck saved before `showObservations`/`showNextSteps` existed must not read
  // as "both sections off" and get its export refused.
  it("resolves a raw legacy include blob before checking the guard", () => {
    expect(isObservationsPageUnconfigured(RAW_LEGACY_BLOB)).toBe(false);
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

  // Same read path as the guard test above — the launcher row's summary comes
  // from `selected-page-row.tsx`'s `page.summarizeOptions(props.options as
  // never)`, the raw restored blob, not a parsed one.
  it("resolves a raw legacy include blob before summarizing", () => {
    expect(summarizeObservationsOptions(RAW_LEGACY_BLOB)).toBe("Observations · Next Steps · all topics");
  });
});
