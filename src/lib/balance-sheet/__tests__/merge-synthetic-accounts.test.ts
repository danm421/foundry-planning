// src/lib/balance-sheet/__tests__/merge-synthetic-accounts.test.ts
import { describe, it, expect } from "vitest";
import type { ClientData } from "@/engine/types";
import type { ProjectionYear } from "@/engine/types";
import { mergeSyntheticAccounts } from "../merge-synthetic-accounts";

type SyntheticAccount = NonNullable<ProjectionYear["syntheticAccounts"]>[number];

const SYN: SyntheticAccount = {
  id: "equity-dest-plan1",
  name: "TSLA shares",
  category: "taxable",
  owners: [{ kind: "family_member", familyMemberId: "c", percent: 1 }],
};

const baseClientData = {
  accounts: [
    {
      id: "a1",
      name: "Checking",
      category: "cash",
      owners: [{ kind: "family_member", familyMemberId: "c", percent: 1 }],
    },
  ],
} as unknown as ClientData;

describe("mergeSyntheticAccounts", () => {
  it("merges a synthetic account from a held year into accounts", () => {
    const years: Pick<ProjectionYear, "syntheticAccounts">[] = [
      { syntheticAccounts: [SYN] },
    ];
    const result = mergeSyntheticAccounts(baseClientData, years);
    expect(result.accounts).toHaveLength(2);
    const merged = result.accounts!.find((a) => a.id === SYN.id);
    expect(merged).toMatchObject({ id: SYN.id, name: SYN.name, category: SYN.category });
  });

  it("selects from the FIRST year that has a non-empty syntheticAccounts array", () => {
    const years: Pick<ProjectionYear, "syntheticAccounts">[] = [
      { syntheticAccounts: undefined },
      { syntheticAccounts: [SYN] },
      { syntheticAccounts: [] },
    ];
    const result = mergeSyntheticAccounts(baseClientData, years);
    expect(result.accounts!.find((a) => a.id === SYN.id)).toBeDefined();
  });

  it("does NOT add a synthetic account whose id already exists in clientData.accounts (dedup)", () => {
    const duplicate = {
      ...baseClientData,
      accounts: [
        {
          id: SYN.id,
          name: "Original Name",
          category: "taxable",
          owners: [],
        },
        ...baseClientData.accounts!,
      ],
    } as unknown as ClientData;
    const years: Pick<ProjectionYear, "syntheticAccounts">[] = [
      { syntheticAccounts: [SYN] },
    ];
    const result = mergeSyntheticAccounts(duplicate, years);
    // Still only 2 accounts (the duplicate + existing "a1"), not 3
    expect(result.accounts).toHaveLength(2);
    // The original account's name is preserved (not clobbered)
    expect(result.accounts!.find((a) => a.id === SYN.id)?.name).toBe("Original Name");
  });

  it("returns accounts unchanged when there are no synthetic accounts in any year", () => {
    const years: Pick<ProjectionYear, "syntheticAccounts">[] = [
      { syntheticAccounts: undefined },
      { syntheticAccounts: [] },
    ];
    const result = mergeSyntheticAccounts(baseClientData, years);
    expect(result.accounts).toHaveLength(baseClientData.accounts!.length);
    expect(result.accounts![0].id).toBe("a1");
  });
});
