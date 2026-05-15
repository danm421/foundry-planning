import { describe, it, expect } from "vitest";
import { summarizeDeathWarnings } from "../death-warning-summary";

const names = new Map<string, string>([
  ["acct-1", "Savings Account"],
  ["acct-2", "Schwab Ind. Account"],
  ["acct-3", "IRA"],
  ["pol-1", "Cooper - Term"],
]);

describe("summarizeDeathWarnings", () => {
  it("returns [] for no warnings", () => {
    expect(summarizeDeathWarnings([], names)).toEqual([]);
  });

  it("groups residual_fallback_fired into one note with resolved asset names", () => {
    const notes = summarizeDeathWarnings(
      [
        "residual_fallback_fired:acct-1",
        "residual_fallback_fired:acct-2",
        "residual_fallback_fired:acct-3",
      ],
      names,
    );
    expect(notes).toHaveLength(1);
    expect(notes[0].key).toBe("residual_fallback_fired");
    expect(notes[0].message).toContain("3 assets have");
    expect(notes[0].items).toEqual([
      "Savings Account",
      "Schwab Ind. Account",
      "IRA",
    ]);
  });

  it("uses singular phrasing for a single fallback", () => {
    const notes = summarizeDeathWarnings(["residual_fallback_fired:acct-1"], names);
    expect(notes[0].message).toContain("1 asset has");
  });

  it("falls back to the raw id when no name is known", () => {
    const notes = summarizeDeathWarnings(
      ["residual_fallback_fired:unmapped-uuid"],
      names,
    );
    expect(notes[0].items).toEqual(["unmapped-uuid"]);
  });

  it("dedupes a repeated reference within a group", () => {
    const notes = summarizeDeathWarnings(
      ["residual_fallback_fired:acct-1", "residual_fallback_fired:acct-1"],
      names,
    );
    expect(notes[0].items).toEqual(["Savings Account"]);
    expect(notes[0].message).toContain("1 asset has");
  });

  it("translates over_allocation_in_will", () => {
    const notes = summarizeDeathWarnings(["over_allocation_in_will:acct-2"], names);
    expect(notes[0].key).toBe("over_allocation_in_will");
    expect(notes[0].message).toContain("more than 100%");
    expect(notes[0].items).toEqual(["Schwab Ind. Account"]);
  });

  it("translates life_insurance_no_beneficiaries", () => {
    const notes = summarizeDeathWarnings(
      ["life_insurance_no_beneficiaries:pol-1"],
      names,
    );
    expect(notes[0].message).toContain("life insurance");
    expect(notes[0].items).toEqual(["Cooper - Term"]);
  });

  it("parses trust_beneficiaries_incomplete detail with a space after the colon", () => {
    const notes = summarizeDeathWarnings(
      ["trust_beneficiaries_incomplete: trust-1 (sum=80%)"],
      names,
    );
    expect(notes[0].key).toBe("trust_beneficiaries_incomplete");
    expect(notes[0].items).toEqual(["trust-1 (sum=80%)"]);
  });

  it("counts trust_pour_out_fallback_fired", () => {
    const notes = summarizeDeathWarnings(
      ["trust_pour_out_fallback_fired: trust-1", "trust_pour_out_fallback_fired: trust-2"],
      names,
    );
    expect(notes[0].message).toContain("2 trusts have");
  });

  it("collapses all liability_bequest_* codes into one note", () => {
    const notes = summarizeDeathWarnings(
      [
        "liability_bequest_target_missing:x",
        "liability_bequest_ineligible:y",
        "liability_bequest_no_recipients:z",
      ],
      names,
    );
    expect(notes).toHaveLength(1);
    expect(notes[0].message).toContain("3 will liability bequests");
  });

  it("passes unknown codes through verbatim so no signal is lost", () => {
    const notes = summarizeDeathWarnings(["some_new_code:detail"], names);
    expect(notes[0].message).toBe("some_new_code:detail");
    expect(notes[0].items).toEqual([]);
  });

  it("orders notes: residual, over-allocation, then the rest", () => {
    const notes = summarizeDeathWarnings(
      ["over_allocation_in_will:acct-1", "residual_fallback_fired:acct-2"],
      names,
    );
    expect(notes.map((n) => n.key)).toEqual([
      "residual_fallback_fired",
      "over_allocation_in_will",
    ]);
  });
});
