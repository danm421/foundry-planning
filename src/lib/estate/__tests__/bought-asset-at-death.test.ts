import { describe, it, expect } from "vitest";
import { runProjectionWithEvents } from "@/engine";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "@/engine/ownership";
import type { AssetTransaction, ClientData } from "@/engine/types";
import { buildMarriedEstateFixture } from "@/engine/__tests__/fixtures/married-estate-fixture";
import { estateDistributionAtYear } from "../estate-distribution-at-year";
import { buildEstateTransferReportData } from "../transfer-report";

// A bought asset is minted by the engine mid-projection, so its owner is not
// typed by the advisor — the engine stamps one. Every engine fixture names its
// principals with the legacy sentinel ids, which hid that the stamp WAS the
// sentinel: in a real household (uuid family members) the death step compared
// the sentinel to the decedent's real id, saw a stranger, and left the home and
// its mortgage out of both estates — Total to Heirs short by the whole house.

const BUY: AssetTransaction = {
  id: "buy-lake",
  name: "Buy Lake Home",
  type: "buy",
  year: 2033,
  assetName: "Lake Home",
  assetCategory: "real_estate",
  assetSubType: "primary_residence",
  purchasePrice: 1_100_000,
  growthRate: 0.03,
  fundingAccountId: "client-brok",
  mortgageAmount: 500_000,
  mortgageRate: 0.03,
  mortgageTermMonths: 360,
};

/** The fixture as a real household stores it: principals carry uuid-style ids. */
function withRealPersonIds(data: ClientData): ClientData {
  return JSON.parse(
    JSON.stringify(data)
      .replaceAll(LEGACY_FM_CLIENT, "fm-client-1")
      .replaceAll(LEGACY_FM_SPOUSE, "fm-spouse-1"),
  );
}

const ownerNames = { clientName: "Client", spouseName: "Spouse" };

function finalDeath(data: ClientData) {
  const projection = runProjectionWithEvents(data);
  const year = projection.secondDeathEvent!.year;
  return { projection, year };
}

describe("an asset bought during the plan, at death", () => {
  const legacy: ClientData = { ...buildMarriedEstateFixture(), assetTransactions: [BUY] };
  const real = withRealPersonIds(legacy);
  const realRun = finalDeath(real);

  it("passes the home AND its mortgage to the heirs at the final death", () => {
    const { projection, year } = realRun;
    const report = buildEstateTransferReportData({
      projection,
      asOf: { kind: "year", year },
      ordering: "primaryFirst",
      clientData: real,
      ownerNames,
    });
    const assets = (report.secondDeath?.recipients ?? [])
      .flatMap((r) => r.byMechanism.flatMap((m) => m.assets));

    const home = assets.filter((a) => a.sourceAccountId === "technique-acct-buy-lake");
    const homeValue = projection.years.find((y) => y.year === year)!
      .accountLedgers["technique-acct-buy-lake"].endingValue;
    expect(homeValue).toBeGreaterThan(1_100_000);
    expect(home.reduce((s, a) => s + a.amount, 0)).toBeCloseTo(homeValue, 0);

    const mortgage = assets.filter((a) => a.sourceLiabilityId?.startsWith("technique-liab"));
    expect(mortgage.length).toBeGreaterThan(0);
    expect(mortgage.reduce((s, a) => s + a.amount, 0)).toBeLessThan(0);
  });

  // The client dies first (2045); a home the surviving spouse buys afterwards
  // must be the spouse's, not stamped with the client who is already dead.
  it("passes on a home the surviving spouse buys after the first death", () => {
    const widowBuy = withRealPersonIds({ ...legacy, assetTransactions: [{ ...BUY, year: 2047 }] });
    const { projection, year } = finalDeath(widowBuy);
    expect(projection.firstDeathEvent!.year).toBeLessThan(2047);
    const report = buildEstateTransferReportData({
      projection,
      asOf: { kind: "year", year },
      ordering: "primaryFirst",
      clientData: widowBuy,
      ownerNames,
    });
    const passed = (report.secondDeath?.recipients ?? [])
      .flatMap((r) => r.byMechanism.flatMap((m) => m.assets))
      .filter((a) => a.sourceAccountId === "technique-acct-buy-lake")
      .reduce((s, a) => s + a.amount, 0);
    const homeValue = projection.years.find((y) => y.year === year)!
      .accountLedgers["technique-acct-buy-lake"].endingValue;
    expect(homeValue).toBeGreaterThan(1_100_000);
    expect(passed).toBeCloseTo(homeValue, 0);
  });

  it("gives the same Total to Heirs whatever the household's person ids are", () => {
    const toHeirs = (data: ClientData, { projection, year } = finalDeath(data)) =>
      estateDistributionAtYear({ projection, year, clientData: data, ownerNames }).toHeirs;
    expect(toHeirs(real, realRun)).toBeCloseTo(toHeirs(legacy), 0);
  });
});
