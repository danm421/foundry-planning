import { describe, it, expect } from "vitest";
import {
  canBeInheritedIra,
  validateInheritedIraFields,
  inheritedIraBodyFields,
  inheritedIraFormError,
  inheritedIraRowFields,
  inheritedPayoutFormError,
} from "../inherited-ira";

const V = (over: Partial<Parameters<typeof validateInheritedIraFields>[0]>) =>
  validateInheritedIraFields({
    category: "retirement", subType: "traditional_ira",
    inheritedDeathYear: 2022, inheritedOwnerBirthYear: 1945, currentYear: 2026, ...over,
  });

describe("canBeInheritedIra", () => {
  it("allows only Traditional and Roth IRAs", () => {
    expect(canBeInheritedIra("retirement", "traditional_ira")).toBe(true);
    expect(canBeInheritedIra("retirement", "roth_ira")).toBe(true);
    expect(canBeInheritedIra("retirement", "401k")).toBe(false);
    expect(canBeInheritedIra("taxable", "traditional_ira")).toBe(false);
  });
});

describe("validateInheritedIraFields", () => {
  it("accepts a valid pair and an absent pair", () => {
    expect(V({})).toBeNull();
    expect(V({ inheritedDeathYear: null, inheritedOwnerBirthYear: null })).toBeNull();
    expect(V({ subType: "401k", inheritedDeathYear: null, inheritedOwnerBirthYear: undefined })).toBeNull();
  });
  it("rejects half a pair", () => {
    expect(V({ inheritedOwnerBirthYear: null })).toMatch(/both the year of death/);
  });
  it("rejects a non-IRA", () => {
    expect(V({ subType: "401k" })).toMatch(/Traditional or Roth IRA/);
  });
  it("rejects impossible years", () => {
    expect(V({ inheritedDeathYear: 2022.5 })).toMatch(/whole numbers/);
    expect(V({ inheritedOwnerBirthYear: 1899 })).toMatch(/1900 or later/);
    expect(V({ inheritedDeathYear: 1945 })).toMatch(/after the original owner's birth year/);
    expect(V({ inheritedOwnerBirthYear: 1900, inheritedDeathYear: 2021 })).toMatch(/older than 120/);
    expect(V({ inheritedDeathYear: 2027 })).toMatch(/later than 2026/);
  });
});

describe("inheritedIraBodyFields", () => {
  const ticked = { inherited: true, deathYear: "2022", ownerBirthYear: "1945", heirDisabled: true };
  it("sends numbers when ticked on an IRA", () => {
    expect(inheritedIraBodyFields(ticked, "retirement", "roth_ira")).toEqual({
      inheritedDeathYear: 2022, inheritedOwnerBirthYear: 1945, inheritedHeirDisabled: true,
      inheritedPayoutFromYear: null, inheritedPayoutThroughYear: null,
    });
  });
  it("clears everything when unticked", () => {
    expect(inheritedIraBodyFields({ ...ticked, inherited: false }, "retirement", "traditional_ira")).toEqual({
      inheritedDeathYear: null, inheritedOwnerBirthYear: null, inheritedHeirDisabled: false,
      inheritedPayoutFromYear: null, inheritedPayoutThroughYear: null,
    });
  });
  it("clears everything when the account type can't be inherited (type switched to 401(k))", () => {
    expect(inheritedIraBodyFields(ticked, "retirement", "401k")).toEqual({
      inheritedDeathYear: null, inheritedOwnerBirthYear: null, inheritedHeirDisabled: false,
      inheritedPayoutFromYear: null, inheritedPayoutThroughYear: null,
    });
  });
});

describe("inheritedIraFormError", () => {
  const blank = { inherited: true, deathYear: "", ownerBirthYear: "", heirDisabled: false };
  it("asks for both years when ticked and blank", () => {
    expect(inheritedIraFormError(blank, "retirement", "traditional_ira", 2026)).toMatch(/Enter the year of death/);
  });
  it("is silent when unticked or not an IRA", () => {
    expect(inheritedIraFormError({ ...blank, inherited: false }, "retirement", "traditional_ira", 2026)).toBeNull();
    expect(inheritedIraFormError(blank, "retirement", "401k", 2026)).toBeNull();
  });
  it("passes through the server rules", () => {
    expect(inheritedIraFormError({ ...blank, deathYear: "2030", ownerBirthYear: "1945" }, "retirement", "traditional_ira", 2026)).toMatch(/later than 2026/);
  });
});

describe("inheritedIraRowFields", () => {
  it("normalizes undefined to null/false", () => {
    expect(inheritedIraRowFields({})).toEqual({ inheritedDeathYear: null, inheritedOwnerBirthYear: null, inheritedHeirDisabled: false, inheritedPayoutFromYear: null, inheritedPayoutThroughYear: null });
    expect(inheritedIraRowFields({ inheritedDeathYear: 2022, inheritedOwnerBirthYear: 1945, inheritedHeirDisabled: true }))
      .toEqual({ inheritedDeathYear: 2022, inheritedOwnerBirthYear: 1945, inheritedHeirDisabled: true, inheritedPayoutFromYear: null, inheritedPayoutThroughYear: null });
  });
});

describe("payout window — validateInheritedIraFields", () => {
  const P = (from: number | null | undefined, through: number | null | undefined, over = {}) =>
    V({ inheritedPayoutFromYear: from, inheritedPayoutThroughYear: through, ...over });
  it("accepts a valid window and no window", () => {
    expect(P(2023, 2032)).toBeNull();
    expect(P(2026, 2026)).toBeNull();
    expect(P(null, null)).toBeNull();
    expect(P(undefined, undefined)).toBeNull();
  });
  it("rejects half a window", () => {
    expect(P(2026, null)).toBe("Enter the first and last payout years.");
    expect(P(null, 2030)).toBe("Enter the first and last payout years.");
  });
  it("rejects a window starting on or before the year of death", () => {
    expect(P(2022, 2030)).toBe("Payouts can start no earlier than 2023, the year after death.");
  });
  it("rejects a reversed window", () => {
    expect(P(2030, 2029)).toBe("The last payout year can't be before the first.");
  });
  it("rejects years that aren't whole numbers", () => {
    expect(P(2026.5, 2030)).toBe("Payout years must be whole numbers.");
  });
  it("ignores a window on an account that isn't inherited (the write path clears it)", () => {
    expect(P(2026, 2030, { inheritedDeathYear: null, inheritedOwnerBirthYear: null })).toBeNull();
  });
});

describe("payout window — inheritedIraBodyFields", () => {
  const even = {
    inherited: true, deathYear: "2026", ownerBirthYear: "1930", heirDisabled: false,
    payoutPlan: "even" as const, payoutFromYear: "2031", payoutThroughYear: "2036",
  };
  const NO_WINDOW = { inheritedPayoutFromYear: null, inheritedPayoutThroughYear: null };
  it("sends the window as numbers for 'Spread payouts evenly'", () => {
    expect(inheritedIraBodyFields(even, "retirement", "traditional_ira"))
      .toMatchObject({ inheritedPayoutFromYear: 2031, inheritedPayoutThroughYear: 2036 });
  });
  it("sends nulls for 'Minimum each year', even with years still typed", () => {
    expect(inheritedIraBodyFields({ ...even, payoutPlan: "minimum" }, "retirement", "traditional_ira")).toMatchObject(NO_WINDOW);
  });
  it("sends nulls when unticked or the type can't be inherited", () => {
    expect(inheritedIraBodyFields({ ...even, inherited: false }, "retirement", "traditional_ira")).toMatchObject(NO_WINDOW);
    expect(inheritedIraBodyFields(even, "retirement", "401k")).toMatchObject(NO_WINDOW);
  });
  it("sends null for a blank year", () => {
    expect(inheritedIraBodyFields({ ...even, payoutThroughYear: "" }, "retirement", "traditional_ira"))
      .toMatchObject({ inheritedPayoutFromYear: 2031, inheritedPayoutThroughYear: null });
  });
});

describe("payout window — inheritedIraFormError", () => {
  it("ignores the window: its errors show under the window, not in the year-of-death slot", () => {
    expect(inheritedIraFormError(
      { inherited: true, deathYear: "2026", ownerBirthYear: "1930", heirDisabled: false, payoutPlan: "even", payoutFromYear: "2020", payoutThroughYear: "2019" },
      "retirement", "traditional_ira", 2026,
    )).toBeNull();
  });
});

describe("inheritedPayoutFormError", () => {
  // EX2 dates: death 2022, owner born 1945; heir born 1975 → 10-year rule, deadline 2032.
  const even = {
    inherited: true, deathYear: "2022", ownerBirthYear: "1945", heirDisabled: false,
    payoutPlan: "even" as const, payoutFromYear: "2026", payoutThroughYear: "2032",
  };
  it("is silent for a valid window, for 'Minimum each year', and when unticked", () => {
    expect(inheritedPayoutFormError(even, "retirement", "traditional_ira", 1975)).toBeNull();
    expect(inheritedPayoutFormError({ ...even, payoutPlan: "minimum", payoutFromYear: "" }, "retirement", "traditional_ira", 1975)).toBeNull();
    expect(inheritedPayoutFormError({ ...even, inherited: false }, "retirement", "traditional_ira", 1975)).toBeNull();
  });
  it("asks for both years", () => {
    expect(inheritedPayoutFormError({ ...even, payoutThroughYear: "" }, "retirement", "traditional_ira", 1975))
      .toBe("Enter the first and last payout years.");
  });
  it("passes through the server rules", () => {
    expect(inheritedPayoutFormError({ ...even, payoutFromYear: "2022" }, "retirement", "traditional_ira", 1975))
      .toBe("Payouts can start no earlier than 2023, the year after death.");
  });
  it("blocks a last year after the 10-year deadline", () => {
    expect(inheritedPayoutFormError({ ...even, payoutThroughYear: "2033" }, "retirement", "traditional_ira", 1975))
      .toBe("The 10-year rule empties this account by 2032, so the last payout year can't be later.");
  });
  it("allows any last year on a stretch account", () => {
    expect(inheritedPayoutFormError({ ...even, deathYear: "2015", ownerBirthYear: "1940", payoutThroughYear: "2045" }, "retirement", "traditional_ira", 1975))
      .toBeNull();
  });
  it("skips the deadline check when the heir's birth year is unknown", () => {
    expect(inheritedPayoutFormError({ ...even, payoutThroughYear: "2033" }, "retirement", "traditional_ira", null)).toBeNull();
  });
  it("stays silent while the year-of-death pair is incomplete (that error shows instead)", () => {
    // A half window, so deleting the year-of-death guard would surface its error.
    expect(inheritedPayoutFormError({ ...even, deathYear: "", payoutThroughYear: "" }, "retirement", "traditional_ira", 1975)).toBeNull();
  });
  it("asks for the years when 'spread evenly' is chosen and both are blank", () => {
    expect(inheritedPayoutFormError({ ...even, payoutFromYear: "", payoutThroughYear: "" }, "retirement", "traditional_ira", 1975))
      .toBe("Enter the first and last payout years.");
    expect(inheritedPayoutFormError({ ...even, payoutFromYear: "", payoutThroughYear: "" }, "retirement", "traditional_ira", null))
      .toBe("Enter the first and last payout years.");
  });
});

describe("payout window — inheritedIraRowFields", () => {
  it("carries the window on an inherited account", () => {
    expect(inheritedIraRowFields({ inheritedDeathYear: 2026, inheritedOwnerBirthYear: 1930, inheritedPayoutFromYear: 2031, inheritedPayoutThroughYear: 2036 }))
      .toMatchObject({ inheritedPayoutFromYear: 2031, inheritedPayoutThroughYear: 2036 });
  });
  it("drops the window when the account isn't inherited, or the window is half-set", () => {
    const none = { inheritedPayoutFromYear: null, inheritedPayoutThroughYear: null };
    expect(inheritedIraRowFields({ inheritedPayoutFromYear: 2031, inheritedPayoutThroughYear: 2036 })).toMatchObject(none);
    expect(inheritedIraRowFields({ inheritedDeathYear: 2026, inheritedOwnerBirthYear: 1930, inheritedPayoutFromYear: 2031 })).toMatchObject(none);
  });
  it("drops a reversed or fractional window but keeps the death/owner fields", () => {
    const row = { inheritedDeathYear: 2026, inheritedOwnerBirthYear: 1930 };
    expect(inheritedIraRowFields({ ...row, inheritedPayoutFromYear: 2036, inheritedPayoutThroughYear: 2031 })).toEqual({
      inheritedDeathYear: 2026, inheritedOwnerBirthYear: 1930, inheritedHeirDisabled: false,
      inheritedPayoutFromYear: null, inheritedPayoutThroughYear: null,
    });
    expect(inheritedIraRowFields({ ...row, inheritedPayoutFromYear: 2031.5, inheritedPayoutThroughYear: 2036 }))
      .toMatchObject({ inheritedPayoutFromYear: null, inheritedPayoutThroughYear: null });
  });
});
