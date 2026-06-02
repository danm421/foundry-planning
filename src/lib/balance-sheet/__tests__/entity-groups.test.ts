import { describe, it, expect } from "vitest";
import type { EntityGroup } from "@/components/balance-sheet-report/view-model";
import { dedupeFlatEntityGroup, prepareEntityGroups } from "../entity-groups";

function group(over: Partial<EntityGroup>): EntityGroup {
  return {
    entityId: "e1",
    entityName: "Acme LLC",
    entityType: "llc",
    assetRows: [],
    assetTotal: 0,
    liabilityRows: [],
    liabilityTotal: 0,
    netWorth: 0,
    ...over,
  } as EntityGroup;
}

const asset = (rowKey: string, value: number) =>
  ({ rowKey, accountId: rowKey, accountName: rowKey, owner: null, ownerEntityId: "e1", value }) as EntityGroup["assetRows"][number];

describe("dedupeFlatEntityGroup", () => {
  it("strips the flat row and recomputes totals when real accounts exist", () => {
    const g = group({
      assetRows: [asset("flat:e1", 1_000_000), asset("acct-1", 250_000)],
      assetTotal: 1_250_000,
      liabilityTotal: 50_000,
      netWorth: 1_200_000,
    });
    const out = dedupeFlatEntityGroup(g);
    expect(out.assetRows.map((r) => r.rowKey)).toEqual(["acct-1"]);
    expect(out.assetTotal).toBe(250_000);
    expect(out.netWorth).toBe(200_000);
  });

  it("keeps the flat row when there are no real accounts", () => {
    const g = group({
      assetRows: [asset("flat:e1", 1_000_000)],
      assetTotal: 1_000_000,
      netWorth: 1_000_000,
    });
    expect(dedupeFlatEntityGroup(g)).toEqual(g);
  });
});

describe("prepareEntityGroups", () => {
  it("dedupes flat rows and drops entities with no rows", () => {
    const withRows = group({ assetRows: [asset("acct-1", 100)], assetTotal: 100, netWorth: 100 });
    const empty = group({ entityId: "e2", entityName: "Empty Trust" });
    const out = prepareEntityGroups([withRows, empty]);
    expect(out.map((g) => g.entityId)).toEqual(["e1"]);
  });

  it("keeps an entity that has only liabilities", () => {
    const g = group({
      liabilityRows: [{ rowKey: "l1", liabilityName: "Loan", balance: 500 }] as EntityGroup["liabilityRows"],
      liabilityTotal: 500,
      netWorth: -500,
    });
    expect(prepareEntityGroups([g])).toHaveLength(1);
  });
});
