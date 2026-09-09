import { describe, it, expect } from "vitest";
import { applyScenarioChanges } from "@/engine/scenario/applyChanges";
import type { ClientData, EntitySummary } from "@/engine/types";
import type { ScenarioChange } from "@/engine/scenario/types";
import type { Gift, GiftSeriesLite } from "@/components/family-view";
import {
  entitySummaryToRow,
  giftDraftToRow,
  giftDraftToSeriesRow,
  overlayScenarioGiftRows,
} from "../family-scenario-rows";

// The exact payload the solver's "save as scenario" writes for a SLAT — the
// case that used to render "No trusts yet" on the Profile page.
const slat = {
  id: "slat-1",
  name: "SLAT for Client",
  grantor: "client",
  isGrantor: true,
  trustEnds: "survivorship",
  entityType: "trust",
  trustSubType: "idgt",
  crummeyPowers: false,
  isIrrevocable: true,
  accessibleToClient: false,
  includeInPortfolio: false,
} as unknown as EntitySummary;

const ch = (
  opType: "add" | "remove",
  targetId: string,
  payload: unknown,
): ScenarioChange => ({
  id: `c-${targetId}`, scenarioId: "s", opType, targetKind: "gift",
  targetId, payload, toggleGroupId: null, orderIndex: 0,
});

describe("entitySummaryToRow", () => {
  it("renders a scenario-only trust with no base row behind it", () => {
    expect(entitySummaryToRow(slat)).toMatchObject({
      id: "slat-1",
      name: "SLAT for Client",
      entityType: "trust",
      trustSubType: "idgt",
      isIrrevocable: true,
      trustEnds: "survivorship",
      grantor: "client",
      // Columns only the `entities` table carries — absent here, never undefined.
      notes: null,
      owner: null,
      beneficiaries: null,
      // The dialog's numeric fields must be filled, not left undefined.
      value: "0",
      basis: "0",
      owners: [],
      trustee: null,
      distributionMode: null,
      distributionAmount: null,
      distributionPercent: null,
    });
  });

  it("carries the base row's notes / owner / legacy beneficiaries", () => {
    const row = entitySummaryToRow(
      { ...slat, value: 250000, basis: 100000 },
      { notes: "Funded 2026", owner: "joint", beneficiaries: [{ name: "Kid", pct: 100 }] },
    );
    expect(row).toMatchObject({
      notes: "Funded 2026",
      owner: "joint",
      beneficiaries: [{ name: "Kid", pct: 100 }],
      value: "250000",
      basis: "100000",
    });
  });
});

describe("gift draft → row", () => {
  it("maps an asset gift, keeping the manual valuation in `amount`", () => {
    expect(
      giftDraftToRow({
        kind: "asset-once", id: "g1", year: 2026, accountId: "acct-1", percent: 0.15,
        grantor: "client", recipient: { kind: "entity", id: "slat-1" }, amountOverride: 90000,
      }),
    ).toEqual({
      id: "g1", year: 2026, grantor: "client", amount: 90000,
      recipientEntityId: "slat-1", recipientFamilyMemberId: null,
      recipientExternalBeneficiaryId: null,
      accountId: "acct-1", percent: 0.15, valuationDiscount: null,
      useCrummeyPowers: false, notes: null,
    });
  });

  it("carries a valuation discount through the overlay, on both gift kinds", () => {
    // A scenario-overlaid gift that lost its discount here would show 0% in the
    // Details -> Family dialog while the projection discounted it.
    expect(
      giftDraftToRow({
        kind: "asset-once", id: "g1", year: 2026, accountId: "acct-1", percent: 0.15,
        grantor: "client", recipient: { kind: "entity", id: "slat-1" },
        valuationDiscount: 0.3,
      }),
    ).toMatchObject({ valuationDiscount: 0.3 });
    expect(
      giftDraftToRow({
        kind: "cash-once", id: "g2", year: 2027, amount: 19000, grantor: "spouse",
        recipient: { kind: "entity", id: "slat-1" }, crummey: false,
        valuationDiscount: 0.25,
      }),
    ).toMatchObject({ valuationDiscount: 0.25 });
    expect(
      giftDraftToSeriesRow({
        kind: "series", id: "s1", startYear: 2027, endYear: 2031, annualAmount: 19000,
        amountMode: "fixed", inflationAdjust: true, grantor: "joint",
        recipient: { kind: "entity", id: "slat-1" }, crummey: true,
        valuationDiscount: 0.4,
      }),
    ).toMatchObject({ valuationDiscount: 0.4 });
  });

  it("leaves `amount` null on an asset gift with no override", () => {
    const row = giftDraftToRow({
      kind: "asset-once", id: "g1", year: 2026, accountId: "acct-1", percent: 0.15,
      grantor: "client", recipient: { kind: "entity", id: "slat-1" },
    });
    expect(row).toMatchObject({ amount: null, percent: 0.15 });
  });

  it("maps a cash gift, carrying Crummey powers", () => {
    expect(
      giftDraftToRow({
        kind: "cash-once", id: "g2", year: 2027, amount: 19000, grantor: "spouse",
        recipient: { kind: "family_member", id: "fm1" }, crummey: true,
      }),
    ).toMatchObject({
      amount: 19000, accountId: null, percent: null, useCrummeyPowers: true,
      recipientFamilyMemberId: "fm1", recipientEntityId: null,
    });
  });

  it("routes series drafts to the series builder, not the gift builder", () => {
    const series = {
      kind: "series", id: "s1", startYear: 2027, endYear: 2031, annualAmount: 19000,
      amountMode: "fixed", inflationAdjust: true, grantor: "joint",
      recipient: { kind: "external_beneficiary", id: "ext1" }, crummey: true,
    } as const;
    expect(giftDraftToRow(series)).toBeNull();
    expect(giftDraftToSeriesRow(series)).toMatchObject({
      id: "s1", startYear: 2027, endYear: 2031, annualAmount: 19000,
      inflationAdjust: true, useCrummeyPowers: true,
      recipientExternalBeneficiaryId: "ext1", recipientEntityId: null,
    });
  });
});

describe("overlayScenarioGiftRows", () => {
  const baseGift: Gift = {
    id: "base-g", year: 2030, amount: 10000, grantor: "client",
    recipientEntityId: null, recipientFamilyMemberId: "fm1",
    recipientExternalBeneficiaryId: null, accountId: null, percent: null,
    valuationDiscount: null, useCrummeyPowers: false, notes: "base note",
  };
  const baseSeries: GiftSeriesLite = {
    id: "base-s", grantor: "spouse", recipientEntityId: null,
    recipientFamilyMemberId: "fm1", recipientExternalBeneficiaryId: null,
    startYear: 2027, endYear: 2031, annualAmount: 19000,
    amountMode: "fixed", inflationAdjust: false, valuationDiscount: null,
    useCrummeyPowers: true,
  };

  it("adds the scenario's asset gift alongside the base rows", () => {
    const { gifts, series } = overlayScenarioGiftRows(
      [baseGift],
      [baseSeries],
      [ch("add", "new-g", {
        kind: "asset-once", id: "new-g", year: 2026, accountId: "acct-1",
        percent: 0.15, grantor: "client", recipient: { kind: "entity", id: "slat-1" },
      })],
    );
    expect(gifts.map((g) => g.id)).toEqual(["base-g", "new-g"]);
    expect(series.map((s) => s.id)).toEqual(["base-s"]);
  });

  it("sends a scenario series to the series list, not the gift list", () => {
    const { gifts, series } = overlayScenarioGiftRows(
      [baseGift],
      [baseSeries],
      [ch("add", "new-s", {
        kind: "series", id: "new-s", startYear: 2028, endYear: 2032,
        annualAmount: 20000, amountMode: "annual_exclusion", inflationAdjust: true,
        grantor: "client", recipient: { kind: "entity", id: "slat-1" }, crummey: true,
      })],
    );
    expect(gifts.map((g) => g.id)).toEqual(["base-g"]);
    expect(series.map((s) => s.id)).toEqual(["base-s", "new-s"]);
  });

  it("drops a base gift the scenario removed", () => {
    const { gifts } = overlayScenarioGiftRows([baseGift], [baseSeries], [ch("remove", "base-g", null)]);
    expect(gifts).toEqual([]);
  });

  it("replaces a base gift the scenario edited rather than duplicating it", () => {
    const { gifts } = overlayScenarioGiftRows(
      [baseGift],
      [],
      [ch("add", "base-g", {
        kind: "cash-once", id: "base-g", year: 2030, amount: 25000,
        grantor: "client", recipient: { kind: "family_member", id: "fm1" }, crummey: false,
      })],
    );
    expect(gifts).toHaveLength(1);
    expect(gifts[0]).toMatchObject({ id: "base-g", amount: 25000 });
  });

  it("no gift changes leaves both lists untouched", () => {
    const g = [baseGift];
    const s = [baseSeries];
    const out = overlayScenarioGiftRows(g, s, []);
    expect(out.gifts).toBe(g);
    expect(out.series).toBe(s);
  });
});

// The seam the Profile page actually runs: the engine's scenario overlay feeds
// `entitySummaryToRow`. Payloads below are the rows the solver wrote for the
// "Trust Gifting" scenario that reported this bug.
describe("effective-tree entities → Profile trust rows", () => {
  const baseTree = {
    entities: [
      { id: "base-t", name: "Family Trust", includeInPortfolio: false, isGrantor: false, entityType: "trust" },
    ],
  } as unknown as ClientData;

  const entityAdd = (id: string, name: string) => ({
    id: `c-${id}`, scenarioId: "s", opType: "add" as const, targetKind: "entity" as const,
    targetId: id, toggleGroupId: null, orderIndex: 0,
    payload: {
      id, name, grantor: "client", isGrantor: true, trustEnds: "survivorship",
      entityType: "trust", trustSubType: "idgt", crummeyPowers: false,
      isIrrevocable: true, accessibleToClient: false, includeInPortfolio: false,
    },
  });

  it("surfaces trusts that exist only as scenario changes", () => {
    const { effectiveTree } = applyScenarioChanges(
      baseTree,
      [entityAdd("slat-1", "SLAT for Client"), entityAdd("slat-2", "SLAT for Spouse")],
      {},
      [],
    );
    const rows = (effectiveTree.entities ?? [])
      .map((e) => entitySummaryToRow(e))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(rows.map((r) => r.name)).toEqual([
      "Family Trust", "SLAT for Client", "SLAT for Spouse",
    ]);
    expect(rows[1]).toMatchObject({ trustSubType: "idgt", isIrrevocable: true, notes: null });
  });

  it("hides a base trust the scenario removed", () => {
    const { effectiveTree } = applyScenarioChanges(
      baseTree,
      [{
        id: "c-rm", scenarioId: "s", opType: "remove", targetKind: "entity",
        targetId: "base-t", payload: null, toggleGroupId: null, orderIndex: 0,
      }],
      {},
      [],
    );
    expect((effectiveTree.entities ?? []).map((e) => entitySummaryToRow(e))).toEqual([]);
  });

  it("leaves a trust out while its toggle group is off", () => {
    const change = { ...entityAdd("slat-1", "SLAT for Client"), toggleGroupId: "grp" };
    const groups = [{ id: "grp", scenarioId: "s", name: "SLATs", defaultOn: false, requiresGroupId: null, orderIndex: 0 }];
    const off = applyScenarioChanges(baseTree, [change], {}, groups).effectiveTree;
    const on = applyScenarioChanges(baseTree, [change], { grp: true }, groups).effectiveTree;
    expect((off.entities ?? []).map((e) => e.name)).toEqual(["Family Trust"]);
    expect((on.entities ?? []).map((e) => e.name)).toEqual(["Family Trust", "SLAT for Client"]);
  });
});
