import { describe, it, expect } from "vitest";
import {
  giftSeriesRowToDraft,
  type GiftSeriesDbRow,
} from "@/lib/estate/estate-flow-gifts";

describe("giftSeriesRowToDraft — amountMode + joint", () => {
  const row: GiftSeriesDbRow = {
    id: "se1",
    grantor: "joint",
    recipientEntityId: "t1",
    startYear: 2026,
    endYear: 2035,
    annualAmount: "38000",
    amountMode: "annual_exclusion",
    inflationAdjust: false,
    useCrummeyPowers: true,
  };

  it("carries amountMode and a joint grantor through to the draft", () => {
    const draft = giftSeriesRowToDraft(row);
    expect(draft).toEqual({
      kind: "series",
      id: "se1",
      startYear: 2026,
      endYear: 2035,
      annualAmount: 38000,
      amountMode: "annual_exclusion",
      inflationAdjust: false,
      grantor: "joint",
      recipient: { kind: "entity", id: "t1" },
      crummey: true,
    });
  });

  it("produces the documented key order (diff stability)", () => {
    const draft = giftSeriesRowToDraft(row);
    expect(Object.keys(draft)).toEqual([
      "kind", "id", "startYear", "endYear", "annualAmount",
      "amountMode", "inflationAdjust", "grantor", "recipient", "crummey",
    ]);
  });
});
