import { describe, it, expect } from "vitest";
import {
  incomeYearWindow,
  incomeFormYears,
  incomeSpanLabel,
} from "@/lib/intake/income-years";
import { buildClientMilestones } from "@/lib/milestones";
import type { IntakePayload } from "@/lib/intake/schema";

type IntakeIncome = IntakePayload["income"][number];

// Built through the real milestone table, the same one the projection loader
// resolves against — so these expectations pin the shared rule, not a local copy.
//
// Pat born 1975, retires at 65 → retirement year 2040, last working year 2039.
// Sam born 1980, retires at 62 → retirement year 2042, last working year 2041.
const ANCHORS = buildClientMilestones(
  {
    dateOfBirth: "1975-04-01",
    retirementAge: 65,
    planEndAge: 95,
    spouseDob: "1980-09-12",
    spouseRetirementAge: 62,
  },
  2026,
  2070,
);

const FALLBACKS = { currentYear: 2026, planEndYear: 2070 };

function income(overrides: Partial<IntakeIncome> = {}): IntakeIncome {
  return {
    name: "Salary",
    type: "salary",
    annualAmount: 100000,
    owner: "client",
    endsAtRetirement: false,
    ...overrides,
  };
}

describe("incomeYearWindow", () => {
  it("uses the years the client supplied, with no milestone anchor", () => {
    const w = incomeYearWindow(
      income({ startYear: 2028, endYear: 2035 }),
      ANCHORS,
      FALLBACKS,
    );
    expect(w).toEqual({ startYear: 2028, endYear: 2035, endYearRef: null });
  });

  it("falls back to currentYear → planEndYear when both years are blank", () => {
    // This is the pre-field behaviour, which forms submitted before these
    // fields existed must keep getting.
    const w = incomeYearWindow(income(), ANCHORS, FALLBACKS);
    expect(w).toEqual({ startYear: 2026, endYear: 2070, endYearRef: null });
  });

  it("fills only the missing side of the window", () => {
    expect(incomeYearWindow(income({ startYear: 2030 }), ANCHORS, FALLBACKS).endYear).toBe(2070);
    expect(incomeYearWindow(income({ endYear: 2030 }), ANCHORS, FALLBACKS).startYear).toBe(2026);
  });

  // ── Ends at retirement ────────────────────────────────────────────────────

  it("anchors a client-owned row to client_retirement, ending the year before", () => {
    const w = incomeYearWindow(
      income({ startYear: 2026, endsAtRetirement: true }),
      ANCHORS,
      FALLBACKS,
    );
    // Retirement year is 1975 + 65 = 2040; the last year of salary is 2039,
    // matching resolveMilestone(..., "end") for a transition ref.
    expect(w).toEqual({ startYear: 2026, endYear: 2039, endYearRef: "client_retirement" });
  });

  it("anchors a spouse-owned row to the spouse's own retirement", () => {
    const w = incomeYearWindow(
      income({ owner: "spouse", endsAtRetirement: true }),
      ANCHORS,
      FALLBACKS,
    );
    // 1980 + 62 = 2042 → last working year 2041. Distinct from the client's
    // 2039, so this cannot pass by reading the wrong anchor.
    expect(w).toEqual({ startYear: 2026, endYear: 2041, endYearRef: "spouse_retirement" });
  });

  it("anchors joint income to the primary, whose birth year always exists", () => {
    const w = incomeYearWindow(
      income({ owner: "joint", endsAtRetirement: true }),
      ANCHORS,
      FALLBACKS,
    );
    expect(w.endYearRef).toBe("client_retirement");
    expect(w.endYear).toBe(2039);
  });

  it("falls back to the client anchor for spouse income in a single household", () => {
    // buildClientMilestones leaves `spouseRetirement` undefined without a spouse
    // DOB, so anchoring to it would store a ref that resolves to nothing.
    const single = buildClientMilestones(
      { dateOfBirth: "1975-04-01", retirementAge: 65, planEndAge: 95 },
      2026,
      2070,
    );
    const w = incomeYearWindow(
      income({ owner: "spouse", endsAtRetirement: true }),
      single,
      FALLBACKS,
    );
    expect(w).toEqual({ startYear: 2026, endYear: 2039, endYearRef: "client_retirement" });
  });

  it("ignores a stale end year once the row ends at retirement", () => {
    const w = incomeYearWindow(
      income({ endYear: 2035, endsAtRetirement: true }),
      ANCHORS,
      FALLBACKS,
    );
    expect(w.endYear).toBe(2039);
    expect(w.endYearRef).toBe("client_retirement");
  });
});

describe("incomeFormYears", () => {
  it("returns a fixed-year row as its stored years, unanchored", () => {
    expect(incomeFormYears({ startYear: 2026, endYear: 2040, endYearRef: null })).toEqual({
      startYear: 2026,
      endYear: 2040,
      endsAtRetirement: false,
    });
  });

  it("returns a retirement-anchored row as the checkbox, dropping the resolved year", () => {
    // Prefilling with 2039 would freeze the anchor on re-submit.
    expect(
      incomeFormYears({ startYear: 2026, endYear: 2039, endYearRef: "client_retirement" }),
    ).toEqual({ startYear: 2026, endYear: undefined, endsAtRetirement: true });
  });

  it("treats a spouse retirement anchor the same way", () => {
    expect(
      incomeFormYears({ startYear: 2026, endYear: 2041, endYearRef: "spouse_retirement" }),
    ).toEqual({ startYear: 2026, endYear: undefined, endsAtRetirement: true });
  });

  it("leaves a non-retirement anchor as a fixed year", () => {
    // plan_end is a window bound, not a retirement milestone — the form has no
    // control for it, so it round-trips as the plain year.
    expect(incomeFormYears({ startYear: 2026, endYear: 2070, endYearRef: "plan_end" })).toEqual({
      startYear: 2026,
      endYear: 2070,
      endsAtRetirement: false,
    });
  });

  it("round-trips a retirement anchor through apply without shifting the year", () => {
    const stored = incomeYearWindow(
      income({ startYear: 2026, endsAtRetirement: true }),
      ANCHORS,
      FALLBACKS,
    );
    const reloaded = incomeFormYears({
      startYear: stored.startYear,
      endYear: stored.endYear,
      endYearRef: stored.endYearRef,
    });
    const rewritten = incomeYearWindow(income(reloaded), ANCHORS, FALLBACKS);
    expect(rewritten).toEqual(stored);
  });
});

describe("incomeSpanLabel", () => {
  it("reads a fixed window as both years", () => {
    expect(incomeSpanLabel({ startYear: 2026, endYear: 2040 }, 2026)).toBe("2026 – 2040");
  });

  it("names the anchor instead of a year when the row ends at retirement", () => {
    expect(
      incomeSpanLabel({ startYear: 2026, endYear: 2040, endsAtRetirement: true }, 2026),
    ).toBe("2026 – retirement");
  });

  it("names the defaults apply substitutes for blank years", () => {
    expect(incomeSpanLabel({}, 2026)).toBe("2026 – plan end");
  });
});
