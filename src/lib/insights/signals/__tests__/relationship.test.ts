import { describe, it, expect } from "vitest";
import { relationshipSignals } from "../relationship";
import { signalInputFixture } from "./fixture";

const ids = (i: Parameters<typeof relationshipSignals>[0]) =>
  relationshipSignals(i).map((s) => s.id);

describe("relationshipSignals", () => {
  it("fires nothing for a well-tended relationship", () => {
    expect(relationshipSignals(signalInputFixture())).toEqual([]);
  });

  it("fires overdue_tasks with a correctly pluralised title", () => {
    const i = signalInputFixture();
    i.relationship.overdueTaskCount = 1;
    const one = relationshipSignals(i).find((x) => x.id === "relationship.overdue_tasks");
    expect(one!.title).toBe("1 overdue task");
    i.relationship.overdueTaskCount = 3;
    const many = relationshipSignals(i).find((x) => x.id === "relationship.overdue_tasks");
    expect(many!.title).toBe("3 overdue tasks");
  });

  it("fires stale_contact past 90 days", () => {
    const i = signalInputFixture();
    i.relationship.lastContactAt = new Date("2026-01-01T00:00:00Z");
    expect(ids(i)).toContain("relationship.stale_contact");
  });

  // The bug in the old lint copy: a brand-new client read as "no contact in
  // over 90 days" when the truth is nobody has ever logged one.
  it("distinguishes never-contacted from stale contact", () => {
    const i = signalInputFixture();
    i.relationship.lastContactAt = null;
    expect(ids(i)).toContain("relationship.never_contacted");
    expect(ids(i)).not.toContain("relationship.stale_contact");
  });

  it("fires portal_never_used when invited but never logged in", () => {
    const i = signalInputFixture();
    i.relationship.portalInvitedAt = new Date("2026-01-01T00:00:00Z");
    i.relationship.portalFirstLoginAt = null;
    expect(ids(i)).toContain("relationship.portal_never_used");
  });

  it("does not fire portal_never_used once they have logged in", () => {
    const i = signalInputFixture();
    i.relationship.portalInvitedAt = new Date("2026-01-01T00:00:00Z");
    i.relationship.portalFirstLoginAt = new Date("2026-02-01T00:00:00Z");
    expect(ids(i)).not.toContain("relationship.portal_never_used");
  });

  it("fires an upcoming life event inside the 3-year horizon", () => {
    const i = signalInputFixture();
    i.relationship.planStartYear = 2026;
    i.relationship.lifeEvents = [{ year: 2028, label: "RMDs begin", kind: "rmd" }];
    const s = relationshipSignals(i).find((x) => x.id === "relationship.upcoming_life_event");
    expect(s!.detail).toContain("RMDs begin");
    expect(s!.detail).toContain("2028");
  });

  it("ignores a life event beyond the horizon", () => {
    const i = signalInputFixture();
    i.relationship.planStartYear = 2026;
    i.relationship.lifeEvents = [{ year: 2040, label: "RMDs begin", kind: "rmd" }];
    expect(ids(i)).not.toContain("relationship.upcoming_life_event");
  });

  it("ignores a life event already in the past", () => {
    const i = signalInputFixture();
    i.relationship.planStartYear = 2026;
    i.relationship.lifeEvents = [{ year: 2020, label: "Retirement", kind: "retirement" }];
    expect(ids(i)).not.toContain("relationship.upcoming_life_event");
  });

  // planStartYear is persisted and does NOT track the calendar. A rule keyed to
  // the wall clock would drift a household's signals every January.
  it("measures the horizon against planStartYear, not the clock", () => {
    const i = signalInputFixture();
    i.now = new Date("2040-08-08T00:00:00Z");
    i.relationship.planStartYear = 2026;
    i.relationship.lifeEvents = [{ year: 2028, label: "RMDs begin", kind: "rmd" }];
    expect(ids(i)).toContain("relationship.upcoming_life_event");
  });
});
