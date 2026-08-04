import { describe, it, expect } from "vitest";
import { deriveFirstRunCard } from "../advisor-first-run";

const BASE = {
  eligible: true,
  dismissedAt: null as Date | null,
  client: null as null | {
    id: string;
    householdName: string;
    onboardingCompletedAt: Date | null;
    completedSteps: number;
  },
  totalSteps: 9,
};

describe("deriveFirstRunCard", () => {
  it("hides the card for an advisor who already had a book", () => {
    expect(deriveFirstRunCard({ ...BASE, eligible: false })).toEqual({ kind: "hidden" });
  });

  it("hides the card once dismissed, even mid-setup", () => {
    const card = deriveFirstRunCard({
      ...BASE,
      dismissedAt: new Date("2026-08-04T00:00:00Z"),
      client: { id: "c1", householdName: "Johnson", onboardingCompletedAt: null, completedSteps: 4 },
    });
    expect(card).toEqual({ kind: "hidden" });
  });

  it("offers setup when eligible with no client yet", () => {
    expect(deriveFirstRunCard(BASE)).toEqual({ kind: "no_client" });
  });

  it("reports progress while the wizard is unfinished", () => {
    const card = deriveFirstRunCard({
      ...BASE,
      client: { id: "c1", householdName: "Johnson", onboardingCompletedAt: null, completedSteps: 4 },
    });
    expect(card).toEqual({
      kind: "in_progress",
      clientId: "c1",
      householdName: "Johnson",
      completedSteps: 4,
      totalSteps: 9,
    });
  });

  it("reports done once the wizard is finished", () => {
    const card = deriveFirstRunCard({
      ...BASE,
      client: {
        id: "c1",
        householdName: "Johnson",
        onboardingCompletedAt: new Date("2026-08-04T00:00:00Z"),
        completedSteps: 9,
      },
    });
    expect(card).toEqual({ kind: "done", clientId: "c1" });
  });

  it("prefers dismissal over the done state", () => {
    const card = deriveFirstRunCard({
      ...BASE,
      dismissedAt: new Date("2026-08-04T00:00:00Z"),
      client: {
        id: "c1",
        householdName: "Johnson",
        onboardingCompletedAt: new Date("2026-08-04T00:00:00Z"),
        completedSteps: 9,
      },
    });
    expect(card).toEqual({ kind: "hidden" });
  });
});
