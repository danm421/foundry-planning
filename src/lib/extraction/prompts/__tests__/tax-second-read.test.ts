import { describe, it, expect } from "vitest";
import { TAX_SECOND_READ_PROMPT } from "../tax-second-read";

describe("TAX_SECOND_READ_PROMPT", () => {
  it("names the response shape the schema actually validates", () => {
    for (const key of ["items", "headline", "detail", "form", "line", "quotedValue"]) {
      expect(TAX_SECOND_READ_PROMPT).toContain(`"${key}"`);
    }
  });

  it("forbids arithmetic and any estimated impact — D12 in the prompt as well as the type", () => {
    expect(TAX_SECOND_READ_PROMPT).toMatch(/never (do|perform) arithmetic|do NOT compute/i);
    expect(TAX_SECOND_READ_PROMPT).toMatch(/estimate|projected saving/i);
  });

  it("tells the model not to repeat a finding it is shown", () => {
    expect(TAX_SECOND_READ_PROMPT).toMatch(/already (been )?(reported|covered|found)/i);
  });

  it("states the item cap the code also enforces", () => {
    expect(TAX_SECOND_READ_PROMPT).toMatch(/at most 6 items/i);
  });

  it("permits an empty result — a clean return must be allowed to produce nothing", () => {
    expect(TAX_SECOND_READ_PROMPT).toMatch(/empty|nothing/i);
  });
});
