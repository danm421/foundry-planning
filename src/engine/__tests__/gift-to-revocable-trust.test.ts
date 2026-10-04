// A gift to a trust that is not irrevocable is not a completed gift: no annual
// exclusion, no lifetime exemption, and the trust's assets stay in its
// grantor's estate. It used to throw inside runProjection, taking down every
// projection-backed page for the household.
import { describe, it, expect } from "vitest";
import type { ClientData, EntitySummary } from "../types";
import { runProjection } from "../projection";
import { buildMinimalEstateScenario } from "./_fixtures/estate";

const TRUST_ID = "trust-1";

/** Client (dies 2030) gives 30% of the $20M joint cash account to a trust in
 *  2028, plus a $100K cash gift in 2027. The trust's grantor is the client. */
function scenarioWithGiftToTrust(isIrrevocable: boolean | undefined): ClientData {
  const data = buildMinimalEstateScenario({ priorClient: 0 });
  const trust = {
    id: TRUST_ID,
    name: "Living Trust",
    entityType: "trust",
    grantor: "client",
    isGrantor: true,
    isIrrevocable,
  } as unknown as EntitySummary;
  return {
    ...data,
    entities: [trust],
    gifts: [
      {
        id: "gift-cash",
        year: 2027,
        amount: 100_000,
        grantor: "client",
        recipientEntityId: TRUST_ID,
        useCrummeyPowers: false,
      },
    ] as unknown as ClientData["gifts"],
    giftEvents: [
      {
        kind: "asset",
        year: 2028,
        accountId: "acct-cash",
        percent: 0.3,
        grantor: "client",
        recipientEntityId: TRUST_ID,
      },
    ],
  };
}

const firstDeath = (data: ClientData) =>
  runProjection(data).find((y) => y.estateTax?.deathOrder === 1)!.estateTax!;

describe("a gift to a trust that is not irrevocable", () => {
  it("control: the same gifts to an IRREVOCABLE trust draw lifetime exemption", () => {
    // Without this, a zero below could mean the gifts never reached the ledger.
    const tax = firstDeath(scenarioWithGiftToTrust(true));
    expect(tax.adjustedTaxableGifts).toBeGreaterThan(6_000_000);
  });

  it.each([
    ["unset (NULL in the DB)", undefined],
    ["false", false],
  ])("runs the projection when the flag is %s, drawing no exemption", (_label, flag) => {
    const tax = firstDeath(scenarioWithGiftToTrust(flag));
    expect(tax.adjustedTaxableGifts).toBe(0);
  });

  it("keeps the trust's assets in the grantor's gross estate", () => {
    const completed = firstDeath(scenarioWithGiftToTrust(true));
    const incomplete = firstDeath(scenarioWithGiftToTrust(undefined));
    // The 30% slice ($6M, no growth) leaves the estate only when the gift is
    // completed. To a revocable trust it stays in the client's estate.
    expect(incomplete.grossEstate - completed.grossEstate).toBeCloseTo(6_000_000, -3);
  });
});
