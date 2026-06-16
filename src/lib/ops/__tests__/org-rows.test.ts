import { describe, it, expect } from "vitest";
import { buildOrgRows } from "../org-rows";

const FIRM = (over: Partial<Parameters<typeof buildOrgRows>[0][number]> = {}) => ({
  firmId: "org_1",
  displayName: "Acme Advisors",
  isFounder: false,
  archivedAt: null,
  createdAt: new Date("2026-01-02T00:00:00Z"),
  ...over,
});

describe("buildOrgRows", () => {
  it("maps an active subscription onto the firm", () => {
    const rows = buildOrgRows(
      [FIRM()],
      [{ firmId: "org_1", status: "active", trialEnd: null }],
    );
    expect(rows[0]).toEqual({
      firmId: "org_1",
      displayName: "Acme Advisors",
      isFounder: false,
      archived: false,
      subscriptionStatus: "active",
      trialEnd: null,
      createdAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("reports 'none' when a non-founder firm has no active sub", () => {
    const rows = buildOrgRows([FIRM()], []);
    expect(rows[0].subscriptionStatus).toBe("none");
  });

  it("reports 'founder' for founder firms regardless of subs", () => {
    const rows = buildOrgRows([FIRM({ isFounder: true })], []);
    expect(rows[0].subscriptionStatus).toBe("founder");
  });

  it("falls back to '(unnamed)' and flags archived", () => {
    const rows = buildOrgRows(
      [FIRM({ displayName: null, archivedAt: new Date("2026-03-01T00:00:00Z") })],
      [],
    );
    expect(rows[0].displayName).toBe("(unnamed)");
    expect(rows[0].archived).toBe(true);
  });

  it("surfaces the trial end as ISO for trialing subs", () => {
    const rows = buildOrgRows(
      [FIRM()],
      [{ firmId: "org_1", status: "trialing", trialEnd: new Date("2026-02-01T00:00:00Z") }],
    );
    expect(rows[0]).toMatchObject({ subscriptionStatus: "trialing", trialEnd: "2026-02-01T00:00:00.000Z" });
  });
});
