import { describe, it, expect } from "vitest";
import {
  previewPlanSwitch,
  planSwitchCopy,
  type PlanSwitchSubject,
  type PlanSwitchTarget,
} from "../plan-switch-preview";

const PAID_ANNUAL: PlanSwitchSubject = {
  status: "active",
  currentPlan: "annual",
  periodEnd: new Date("2027-09-21T00:00:00Z"),
  trialEnd: null,
};
const PAID_MONTHLY: PlanSwitchSubject = {
  status: "active",
  currentPlan: "monthly",
  periodEnd: new Date("2026-10-21T00:00:00Z"),
  trialEnd: null,
};
const TRIAL_ANNUAL: PlanSwitchSubject = {
  status: "trialing",
  currentPlan: "annual",
  periodEnd: new Date("2026-10-05T00:00:00Z"),
  trialEnd: new Date("2026-10-05T00:00:00Z"),
};
const MONTHLY: PlanSwitchTarget = { plan: "monthly", unitAmount: 19900, currency: "usd" };
const ANNUAL: PlanSwitchTarget = { plan: "annual", unitAmount: 199000, currency: "usd" };

describe("previewPlanSwitch", () => {
  it("defers a paid switch to the end of the paid period", () => {
    const p = previewPlanSwitch(PAID_ANNUAL, MONTHLY);
    expect(p.mode).toBe("scheduled");
    expect(p.effectiveAt).toEqual(new Date("2027-09-21T00:00:00Z"));
    expect(p.dueToday).toBe(0);
  });

  it("defers a paid UPGRADE too — both directions behave the same", () => {
    const p = previewPlanSwitch(PAID_MONTHLY, ANNUAL);
    expect(p.mode).toBe("scheduled");
    expect(p.effectiveAt).toEqual(new Date("2026-10-21T00:00:00Z"));
    expect(p.dueToday).toBe(0);
  });

  it("applies a trial switch immediately and bills nothing", () => {
    const p = previewPlanSwitch(TRIAL_ANNUAL, MONTHLY);
    expect(p.mode).toBe("immediate");
    expect(p.effectiveAt).toEqual(new Date("2026-10-05T00:00:00Z"));
    expect(p.dueToday).toBe(0);
  });

  it("never proposes charging anything today", () => {
    for (const subject of [PAID_ANNUAL, PAID_MONTHLY, TRIAL_ANNUAL]) {
      for (const target of [MONTHLY, ANNUAL]) {
        expect(previewPlanSwitch(subject, target).dueToday).toBe(0);
      }
    }
  });
});

describe("planSwitchCopy", () => {
  it("tells a paid subscriber what they keep and what comes next", () => {
    const copy = planSwitchCopy(previewPlanSwitch(PAID_ANNUAL, MONTHLY), "en-US");
    expect(copy.headline).toBe("You stay on annual until Sep 21, 2027.");
    expect(copy.detail).toBe("From then you'll be billed $199 a month.");
    expect(copy.dueToday).toBe("Nothing is due today.");
  });

  it("says a year for an annual target", () => {
    const copy = planSwitchCopy(previewPlanSwitch(PAID_MONTHLY, ANNUAL), "en-US");
    expect(copy.headline).toBe("You stay on monthly until Oct 21, 2026.");
    expect(copy.detail).toBe("From then you'll be billed $1,990 a year.");
  });

  it("tells a trialing subscriber the change is now and when the first bill lands", () => {
    const copy = planSwitchCopy(previewPlanSwitch(TRIAL_ANNUAL, MONTHLY), "en-US");
    expect(copy.headline).toBe("Your plan changes to monthly now.");
    expect(copy.detail).toBe("Your first bill is $199 on Oct 5, 2026.");
    expect(copy.dueToday).toBe("Nothing is due today.");
  });
});
