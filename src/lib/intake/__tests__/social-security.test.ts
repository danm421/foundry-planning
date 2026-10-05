import { describe, expect, it } from "vitest";
import {
  answeredSocialSecurity,
  socialSecurityAnswerLabel,
} from "@/lib/intake/social-security";

describe("socialSecurityAnswerLabel", () => {
  it("joins the benefit and the start age", () => {
    expect(socialSecurityAnswerLabel({ piaMonthly: 2800, claimingAge: 67 })).toBe(
      "$2,800/mo at FRA · start at 67",
    );
  });

  it("reads either half alone", () => {
    expect(socialSecurityAnswerLabel({ piaMonthly: 1950.4 })).toBe("$1,950/mo at FRA");
    expect(socialSecurityAnswerLabel({ claimingAge: 62 })).toBe("Start at 62");
  });

  it("is null for no answer — a $0 benefit included", () => {
    expect(socialSecurityAnswerLabel(undefined)).toBeNull();
    expect(socialSecurityAnswerLabel({})).toBeNull();
    expect(socialSecurityAnswerLabel({ piaMonthly: 0 })).toBeNull();
  });
});

describe("answeredSocialSecurity", () => {
  const ss = { client: { claimingAge: 67 }, spouse: { piaMonthly: 2000 } };

  it("names each person who answered, client first", () => {
    const family = { primary: { firstName: "Jane" }, spouse: { firstName: "John" } };
    expect(answeredSocialSecurity(ss, family)).toEqual([
      { owner: "client", name: "Jane", label: "Start at 67" },
      { owner: "spouse", name: "John", label: "$2,000/mo at FRA" },
    ]);
  });

  it("drops a co-client answer when the form has no co-client", () => {
    expect(answeredSocialSecurity(ss, { primary: { firstName: "Jane" }, spouse: null })).toEqual([
      { owner: "client", name: "Jane", label: "Start at 67" },
    ]);
  });

  it("falls back to role words when no names were collected", () => {
    expect(
      answeredSocialSecurity(ss, { spouse: {} }).map((r) => r.name),
    ).toEqual(["Client", "Co-client"]);
  });
});
