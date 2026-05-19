import { describe, it, expect } from "vitest";
import {
  ownerRefToAccountOwnerRows,
  ownerRefFromOwners,
  type OwnerRef,
} from "../owner-ref";
import type { AccountOwner } from "@/engine/ownership";

const CLIENT_FM = "fm-client";
const SPOUSE_FM = "fm-spouse";
const CHILD_FM = "fm-child";

describe("ownerRefToAccountOwnerRows", () => {
  it("joint → two family rows at 0.5 each", () => {
    const rows = ownerRefToAccountOwnerRows(
      { kind: "joint" },
      { clientFmId: CLIENT_FM, spouseFmId: SPOUSE_FM },
    );
    expect(rows).toEqual([
      { familyMemberId: CLIENT_FM, entityId: null, externalBeneficiaryId: null, percent: "0.5000" },
      { familyMemberId: SPOUSE_FM, entityId: null, externalBeneficiaryId: null, percent: "0.5000" },
    ]);
  });

  it("family (client) → one family row at 1.0", () => {
    const rows = ownerRefToAccountOwnerRows(
      { kind: "family", id: CLIENT_FM },
      { clientFmId: CLIENT_FM, spouseFmId: SPOUSE_FM },
    );
    expect(rows).toEqual([
      { familyMemberId: CLIENT_FM, entityId: null, externalBeneficiaryId: null, percent: "1.0000" },
    ]);
  });

  it("family (child) → one family row at 1.0", () => {
    const rows = ownerRefToAccountOwnerRows(
      { kind: "family", id: CHILD_FM },
      { clientFmId: CLIENT_FM, spouseFmId: SPOUSE_FM },
    );
    expect(rows).toEqual([
      { familyMemberId: CHILD_FM, entityId: null, externalBeneficiaryId: null, percent: "1.0000" },
    ]);
  });

  it("entity → one entity row at 1.0", () => {
    const rows = ownerRefToAccountOwnerRows(
      { kind: "entity", id: "ent-1" },
      { clientFmId: CLIENT_FM, spouseFmId: SPOUSE_FM },
    );
    expect(rows).toEqual([
      { familyMemberId: null, entityId: "ent-1", externalBeneficiaryId: null, percent: "1.0000" },
    ]);
  });

  it("external → one external row at 1.0", () => {
    const rows = ownerRefToAccountOwnerRows(
      { kind: "external", id: "ext-1" },
      { clientFmId: CLIENT_FM, spouseFmId: SPOUSE_FM },
    );
    expect(rows).toEqual([
      { familyMemberId: null, entityId: null, externalBeneficiaryId: "ext-1", percent: "1.0000" },
    ]);
  });

  it("joint with no spouse FM → only client row at 1.0", () => {
    const rows = ownerRefToAccountOwnerRows(
      { kind: "joint" },
      { clientFmId: CLIENT_FM, spouseFmId: null },
    );
    expect(rows).toEqual([
      { familyMemberId: CLIENT_FM, entityId: null, externalBeneficiaryId: null, percent: "1.0000" },
    ]);
  });
});

describe("ownerRefFromOwners", () => {
  const ctx = { clientFmId: CLIENT_FM, spouseFmId: SPOUSE_FM };

  it("client+spouse 0.5/0.5 → joint", () => {
    const owners: AccountOwner[] = [
      { kind: "family_member", familyMemberId: CLIENT_FM, percent: 0.5 },
      { kind: "family_member", familyMemberId: SPOUSE_FM, percent: 0.5 },
    ];
    expect(ownerRefFromOwners(owners, ctx)).toEqual({ kind: "joint" });
  });

  it("single family member → family kind", () => {
    expect(
      ownerRefFromOwners(
        [{ kind: "family_member", familyMemberId: CHILD_FM, percent: 1 }],
        ctx,
      ),
    ).toEqual({ kind: "family", id: CHILD_FM });
  });

  it("single entity → entity kind", () => {
    expect(
      ownerRefFromOwners(
        [{ kind: "entity", entityId: "ent-1", percent: 1 }],
        ctx,
      ),
    ).toEqual({ kind: "entity", id: "ent-1" });
  });

  it("single external → external kind", () => {
    expect(
      ownerRefFromOwners(
        [{ kind: "external_beneficiary", externalBeneficiaryId: "ext-1", percent: 1 }],
        ctx,
      ),
    ).toEqual({ kind: "external", id: "ext-1" });
  });

  it("round-trips for every kind", () => {
    const cases: OwnerRef[] = [
      { kind: "joint" },
      { kind: "family", id: CLIENT_FM },
      { kind: "family", id: CHILD_FM },
      { kind: "entity", id: "ent-1" },
      { kind: "external", id: "ext-1" },
    ];
    for (const ref of cases) {
      const rows = ownerRefToAccountOwnerRows(ref, ctx);
      const owners: AccountOwner[] = rows.map((r) => {
        if (r.familyMemberId) return { kind: "family_member", familyMemberId: r.familyMemberId, percent: Number(r.percent) };
        if (r.entityId) return { kind: "entity", entityId: r.entityId, percent: Number(r.percent) };
        return { kind: "external_beneficiary", externalBeneficiaryId: r.externalBeneficiaryId!, percent: Number(r.percent) };
      });
      expect(ownerRefFromOwners(owners, ctx)).toEqual(ref);
    }
  });
});
