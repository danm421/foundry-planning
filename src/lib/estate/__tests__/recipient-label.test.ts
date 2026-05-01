import { describe, it, expect } from "vitest";
import { resolveRecipientLabel } from "../recipient-label";
import type { ClientData, DeathTransfer, FamilyMember, EntitySummary } from "@/engine/types";

function transfer(partial: Partial<DeathTransfer>): DeathTransfer {
  return {
    year: 2030,
    deathOrder: 1,
    deceased: "client",
    sourceAccountId: "acc-1",
    sourceAccountName: "Brokerage",
    sourceLiabilityId: null,
    sourceLiabilityName: null,
    via: "fallback_children",
    recipientKind: "family_member",
    recipientId: "fm-child-1",
    recipientLabel: "Child 1",
    amount: 100_000,
    basis: 50_000,
    resultingAccountId: null,
    resultingLiabilityId: null,
    ...partial,
  };
}

function tree(
  familyMembers: FamilyMember[] = [],
  entities: EntitySummary[] = [],
  externalBeneficiaries: { id: string; name: string }[] = [],
): ClientData {
  return {
    familyMembers,
    entities,
    externalBeneficiaries,
  } as unknown as ClientData;
}

describe("resolveRecipientLabel", () => {
  it("resolves family_member recipients via familyMembers list", () => {
    const t = transfer({
      recipientKind: "family_member",
      recipientId: "fm-1",
      recipientLabel: "Stale Label",
    });
    const data = tree([
      {
        id: "fm-1",
        role: "child",
        relationship: "child",
        firstName: "Alex",
        lastName: "Doe",
        dateOfBirth: "2010-01-01",
      },
    ]);

    const out = resolveRecipientLabel(t, data);

    expect(out.name).toBe("Alex Doe");
    expect(out.kind).toBe("family_member");
    expect(out.relationship).toBe("child");
    expect(out.isTrustRemainder).toBe(false);
  });

  it("falls back to firstName when lastName is null", () => {
    const data = tree([
      {
        id: "fm-1",
        role: "child",
        relationship: "child",
        firstName: "Alex",
        lastName: null,
        dateOfBirth: "2010-01-01",
      },
    ]);
    const out = resolveRecipientLabel(
      transfer({ recipientId: "fm-1" }),
      data,
    );
    expect(out.name).toBe("Alex");
  });

  it("nullifies relationship when relationship === 'other'", () => {
    const data = tree([
      {
        id: "fm-1",
        role: "other",
        relationship: "other",
        firstName: "Friend",
        lastName: null,
        dateOfBirth: "1980-01-01",
      },
    ]);
    const out = resolveRecipientLabel(
      transfer({ recipientId: "fm-1" }),
      data,
    );
    expect(out.relationship).toBeNull();
  });

  it("decorates entity recipients as '<name> remainder' and flags isTrustRemainder", () => {
    const data = tree(
      [],
      [
        {
          id: "ent-1",
          name: "Family ILIT",
          isIrrevocable: true,
          isGrantor: false,
          grantor: "client",
        } as unknown as EntitySummary,
      ],
    );
    const out = resolveRecipientLabel(
      transfer({
        recipientKind: "entity",
        recipientId: "ent-1",
        recipientLabel: "Family ILIT",
      }),
      data,
    );
    expect(out.name).toBe("Family ILIT remainder");
    expect(out.isTrustRemainder).toBe(true);
  });

  it("resolves external_beneficiary by id when present in tree", () => {
    const data = tree([], [], [{ id: "ext-1", name: "Charity Foo" }]);
    const out = resolveRecipientLabel(
      transfer({
        recipientKind: "external_beneficiary",
        recipientId: "ext-1",
        recipientLabel: "Stale",
      }),
      data,
    );
    expect(out.name).toBe("Charity Foo");
  });

  it("resolves spouse recipients to the spouse's actual name from familyMembers", () => {
    const data = tree([
      {
        id: "fm-client",
        role: "client",
        relationship: "other",
        firstName: "Robert",
        lastName: "Kleiner",
        dateOfBirth: "1965-01-01",
      },
      {
        id: "fm-spouse",
        role: "spouse",
        relationship: "other",
        firstName: "Mary",
        lastName: "Kleiner",
        dateOfBirth: "1967-01-01",
      },
    ]);
    const out = resolveRecipientLabel(
      transfer({
        recipientKind: "spouse",
        recipientId: null,
        recipientLabel: "Spouse",
      }),
      data,
    );
    expect(out.name).toBe("Mary Kleiner");
    expect(out.kind).toBe("spouse");
  });

  it("falls back to 'Spouse' literal when no spouse-role family member exists", () => {
    const out = resolveRecipientLabel(
      transfer({
        recipientKind: "spouse",
        recipientId: null,
        recipientLabel: "Spouse",
      }),
      tree(),
    );
    expect(out.name).toBe("Spouse");
  });

  it("uses recipientLabel verbatim for system_default", () => {
    const out = resolveRecipientLabel(
      transfer({
        recipientKind: "system_default",
        recipientId: null,
        recipientLabel: "Other Heirs",
      }),
      tree(),
    );
    expect(out.name).toBe("Other Heirs");
    expect(out.kind).toBe("system_default");
  });

  it("falls back to recipientLabel when family_member id is missing from tree", () => {
    const out = resolveRecipientLabel(
      transfer({
        recipientKind: "family_member",
        recipientId: "fm-missing",
        recipientLabel: "Frozen Label",
      }),
      tree(),
    );
    expect(out.name).toBe("Frozen Label");
  });

  describe("F2 — spouse recipientId is honored over role-based lookup", () => {
    const couple: FamilyMember[] = [
      { id: "fm-client", role: "client", relationship: "other", firstName: "Pat", lastName: null, dateOfBirth: "1970-01-01" },
      { id: "fm-spouse", role: "spouse", relationship: "other", firstName: "Sam", lastName: null, dateOfBirth: "1972-01-01" },
    ];

    it("primaryFirst: recipientId=fm-spouse resolves to the spouse's name", () => {
      const out = resolveRecipientLabel(
        transfer({
          recipientKind: "spouse",
          recipientId: "fm-spouse",
          recipientLabel: "Spouse",
          deceased: "client",
        }),
        tree(couple),
      );
      expect(out.name).toBe("Sam");
      expect(out.kind).toBe("spouse");
    });

    it("spouseFirst: recipientId=fm-client resolves to the surviving CLIENT's name", () => {
      // This is the F2 bug: pre-fix, the resolver used role==='spouse' and
      // returned "Sam" (the deceased) instead of "Pat" (the actual recipient).
      const out = resolveRecipientLabel(
        transfer({
          recipientKind: "spouse",
          recipientId: "fm-client",
          recipientLabel: "Spouse",
          deceased: "spouse",
        }),
        tree(couple),
      );
      expect(out.name).toBe("Pat");
      expect(out.kind).toBe("spouse");
    });

    it("recipientId pointing at a missing FM falls back to role-based lookup", () => {
      const out = resolveRecipientLabel(
        transfer({
          recipientKind: "spouse",
          recipientId: "fm-stale",
          recipientLabel: "Spouse",
        }),
        tree(couple),
      );
      // Falls back to role-based lookup; finds Sam (the spouse).
      expect(out.name).toBe("Sam");
    });
  });
});
