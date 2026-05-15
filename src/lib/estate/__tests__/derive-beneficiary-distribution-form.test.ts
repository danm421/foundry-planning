import { describe, it, expect } from "vitest";
import type { ClientData } from "@/engine/types";
import type { RecipientTotal } from "@/lib/estate/transfer-report";
import { deriveBeneficiaryDistributionForm } from "../derive-beneficiary-distribution-form";

/** Minimal ClientData with the fields the helper reads. */
function tree(over: Partial<ClientData>): ClientData {
  return {
    familyMembers: [],
    externalBeneficiaries: [],
    entities: [],
    ...over,
  } as unknown as ClientData;
}

function rt(over: Partial<RecipientTotal>): RecipientTotal {
  return {
    key: "family_member|fm1",
    recipientLabel: "Alice",
    recipientKind: "family_member",
    fromFirstDeath: 0,
    fromSecondDeath: 0,
    total: 0,
    ...over,
  };
}

describe("deriveBeneficiaryDistributionForm", () => {
  it("attributes a direct family-member receipt entirely to outright", () => {
    const result = deriveBeneficiaryDistributionForm(
      [rt({ key: "family_member|fm1", recipientLabel: "Alice", total: 1000 })],
      tree({}),
    );
    expect(result).toEqual([
      { key: "family_member|fm1", label: "Alice", outright: 1000, inTrust: 0, total: 1000 },
    ]);
  });

  it("attributes a direct external-beneficiary receipt entirely to outright", () => {
    const result = deriveBeneficiaryDistributionForm(
      [
        rt({
          key: "external_beneficiary|ext1",
          recipientKind: "external_beneficiary",
          recipientLabel: "Nephew Joe",
          total: 500,
        }),
      ],
      tree({}),
    );
    expect(result).toEqual([
      { key: "external_beneficiary|ext1", label: "Nephew Joe", outright: 500, inTrust: 0, total: 500 },
    ]);
  });

  it("looks through a trust to its remainder benes, splitting by percentage and form", () => {
    const result = deriveBeneficiaryDistributionForm(
      [rt({ key: "entity|trust1", recipientKind: "entity", recipientLabel: "Family Trust", total: 1000 })],
      tree({
        familyMembers: [
          { id: "fm1", firstName: "Alice", lastName: "Smith" },
          { id: "fm2", firstName: "Bob", lastName: "Smith" },
        ],
        entities: [
          {
            id: "trust1",
            name: "Family Trust",
            remainderBeneficiaries: [
              { familyMemberId: "fm1", percentage: 60, distributionForm: "outright" },
              { familyMemberId: "fm2", percentage: 40, distributionForm: "in_trust" },
            ],
          },
        ],
      } as unknown as Partial<ClientData>),
    );
    expect(result).toEqual([
      { key: "family_member|fm1", label: "Alice Smith", outright: 600, inTrust: 0, total: 600 },
      { key: "family_member|fm2", label: "Bob Smith", outright: 0, inTrust: 400, total: 400 },
    ]);
  });

  it("treats a missing distributionForm as outright", () => {
    const result = deriveBeneficiaryDistributionForm(
      [rt({ key: "entity|trust1", recipientKind: "entity", recipientLabel: "T", total: 800 })],
      tree({
        familyMembers: [{ id: "fm1", firstName: "Alice", lastName: "Smith" }],
        entities: [
          {
            id: "trust1",
            name: "T",
            remainderBeneficiaries: [
              // distributionForm omitted on purpose
              { familyMemberId: "fm1", percentage: 100 },
            ],
          },
        ],
      } as unknown as Partial<ClientData>),
    );
    expect(result[0]).toEqual({
      key: "family_member|fm1",
      label: "Alice Smith",
      outright: 800,
      inTrust: 0,
      total: 800,
    });
  });

  it("merges a direct bequest and a trust remainder share into one bar", () => {
    const result = deriveBeneficiaryDistributionForm(
      [
        rt({ key: "family_member|fm1", recipientLabel: "Alice", total: 1000 }),
        rt({ key: "entity|trust1", recipientKind: "entity", recipientLabel: "T", total: 500 }),
      ],
      tree({
        familyMembers: [{ id: "fm1", firstName: "Alice", lastName: "Smith" }],
        entities: [
          {
            id: "trust1",
            name: "T",
            remainderBeneficiaries: [
              { familyMemberId: "fm1", percentage: 100, distributionForm: "in_trust" },
            ],
          },
        ],
      } as unknown as Partial<ClientData>),
    );
    expect(result).toEqual([
      { key: "family_member|fm1", label: "Alice", outright: 1000, inTrust: 500, total: 1500 },
    ]);
  });

  it("excludes spouse recipients", () => {
    const result = deriveBeneficiaryDistributionForm(
      [rt({ key: "spouse|s1", recipientKind: "spouse", recipientLabel: "Spouse", total: 9000 })],
      tree({}),
    );
    expect(result).toEqual([]);
  });

  it("drops trust funding when the trust has no remainder beneficiaries", () => {
    const result = deriveBeneficiaryDistributionForm(
      [rt({ key: "entity|trust1", recipientKind: "entity", recipientLabel: "T", total: 1000 })],
      tree({ entities: [{ id: "trust1", name: "T" }] } as unknown as Partial<ClientData>),
    );
    expect(result).toEqual([]);
  });

  it("drops a remainder bene that is itself a trust (entityIdRef, no person)", () => {
    const result = deriveBeneficiaryDistributionForm(
      [rt({ key: "entity|trust1", recipientKind: "entity", recipientLabel: "T", total: 1000 })],
      tree({
        entities: [
          {
            id: "trust1",
            name: "T",
            remainderBeneficiaries: [
              { entityIdRef: "trust2", percentage: 100, distributionForm: "outright" },
            ],
          },
        ],
      } as unknown as Partial<ClientData>),
    );
    expect(result).toEqual([]);
  });

  it("drops a remainder bene identified solely by householdRole", () => {
    const result = deriveBeneficiaryDistributionForm(
      [rt({ key: "entity|trust1", recipientKind: "entity", recipientLabel: "T", total: 1000 })],
      tree({
        entities: [
          {
            id: "trust1",
            name: "T",
            remainderBeneficiaries: [
              { householdRole: "client", percentage: 100, distributionForm: "outright" },
            ],
          },
        ],
      } as unknown as Partial<ClientData>),
    );
    expect(result).toEqual([]);
  });

  it("returns an empty array for no recipients", () => {
    expect(deriveBeneficiaryDistributionForm([], tree({}))).toEqual([]);
  });
});
