/**
 * Phase 4 Task 19 — gift-to-trust regression.
 *
 * Per Decision 4 of the spec, flipping `business.owners` to a trust entity
 * should automatically cascade through to every child account that points at
 * the business via `parentAccountId`. The child accounts carry no
 * account_owners rows of their own — their effective owner is inherited
 * from the parent business.
 *
 * This file exercises that inheritance in the estate-flow ownership column.
 * Without the parentAccountId walk in `buildOwnershipColumn`, the child
 * cash account would silently drop out of the trust group (it has empty
 * owners, no controllingFamilyMember, no controllingEntity), under-counting
 * the trust's holdings.
 */

import { describe, it, expect } from "vitest";
import { buildOwnershipColumn } from "../estate-flow-ownership";
import type { Account, ClientData } from "@/engine/types";

const trustEntity = {
  id: "trust-1",
  name: "Smith Family Trust",
  entityType: "trust" as const,
  includeInPortfolio: false,
  isGrantor: true,
  owners: [],
};

const trustOwnedBusiness: Account = {
  id: "biz-1",
  name: "Smith Holdings LLC",
  category: "business",
  subType: "llc",
  value: 500_000,
  basis: 100_000,
  growthRate: 0,
  rmdEnabled: false,
  titlingType: "jtwros",
  businessType: "llc",
  parentAccountId: null,
  // Phase 4 gift-to-trust outcome: owners flipped to the trust.
  owners: [{ kind: "entity", entityId: "trust-1", percent: 1 }],
};

const childCash: Account = {
  id: "biz-1-cash",
  name: "LLC Operating Cash",
  category: "cash",
  subType: "checking",
  value: 50_000,
  basis: 50_000,
  growthRate: 0,
  rmdEnabled: false,
  titlingType: "jtwros",
  parentAccountId: "biz-1",
  // Child accounts carry no account_owners — ownership inherits from parent.
  owners: [],
};

const clientFm = {
  id: "fm-client",
  firstName: "Joe",
  lastName: "Smith",
  role: "client" as const,
  dateOfBirth: "1970-01-01",
};

const baseData = {
  client: {
    firstName: "Joe",
    lastName: "Smith",
    dateOfBirth: "1970-01-01",
    retirementAge: 65,
    planEndAge: 95,
    filingStatus: "single",
  },
  accounts: [trustOwnedBusiness, childCash],
  liabilities: [],
  entities: [trustEntity],
  incomeSources: [],
  expenses: [],
  familyMembers: [clientFm],
  wills: [],
} as unknown as ClientData;

describe("Phase 4 — gift-to-trust ownership cascade via parentAccountId", () => {
  it("child accounts of a trust-owned business resolve under the trust group", () => {
    const out = buildOwnershipColumn(baseData);

    const trustGroup = out.groups.find((g) => g.key === "entity:trust-1");
    expect(trustGroup, "trust ownership group should exist").toBeDefined();
    expect(trustGroup!.label).toBe("Smith Family Trust");

    const businessRow = trustGroup!.assets.find((a) => a.accountId === "biz-1");
    expect(businessRow, "business row under trust group").toBeDefined();

    const childCashRow = trustGroup!.assets.find(
      (a) => a.accountId === "biz-1-cash",
    );
    expect(
      childCashRow,
      "child cash row should appear under the trust group via parentAccountId",
    ).toBeDefined();
    expect(childCashRow!.value).toBe(50_000);
  });

  it("does not duplicate the child account into the client family-member group", () => {
    const out = buildOwnershipColumn(baseData);
    const clientGroup = out.groups.find((g) => g.kind === "client");
    // The client family member has no direct accounts in this fixture.
    // If the resolver erroneously fell back to the client (the only family
    // member), we'd see the child cash here.
    expect(
      clientGroup?.assets.find((a) => a.accountId === "biz-1-cash"),
    ).toBeUndefined();
  });
});
