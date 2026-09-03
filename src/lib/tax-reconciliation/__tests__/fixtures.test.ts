import { describe, it, expect } from "vitest";
import { inputFixture } from "./fixtures";

describe("inputFixture", () => {
  it("keeps the facts' tax year in sync with an overridden taxYear", () => {
    const base = inputFixture();
    expect(base.taxYear).toBe(2025);
    expect(base.facts.taxYear).toBe(2025);

    const moved = inputFixture({ taxYear: 2030 });
    expect(moved.taxYear).toBe(2030);
    expect(moved.facts.taxYear).toBe(2030);
  });

  it("lets explicitly supplied facts win", () => {
    const { facts } = inputFixture({ taxYear: 2030, facts: inputFixture({ taxYear: 2021 }).facts });
    expect(facts.taxYear).toBe(2021);
  });
});
