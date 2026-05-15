import { describe, it, expect } from "vitest";
import { baseWritesForChange } from "../estate-flow-base-writes";
import type { EstateFlowChange } from "../estate-flow-diff";

const CLIENT = "client-1";

function change(
  targetKind: "account" | "entity" | "will",
  targetId: string,
  desiredFields: Record<string, unknown>,
): EstateFlowChange {
  return {
    description: "test change",
    edit: { op: "edit", targetKind, targetId, desiredFields },
  };
}

const OWNERS = [{ kind: "family_member", familyMemberId: "fm-1", percent: 1 }];
const BENEFICIARIES = [
  { id: "b-1", tier: "primary", percentage: 100, familyMemberId: "fm-2", sortOrder: 0 },
];

describe("baseWritesForChange", () => {
  it("maps an account owners-only change to one account PUT", () => {
    const writes = baseWritesForChange(change("account", "acc-1", { owners: OWNERS }), CLIENT);
    expect(writes).toEqual([
      {
        url: "/api/clients/client-1/accounts/acc-1",
        method: "PUT",
        body: { owners: OWNERS },
      },
    ]);
  });

  it("maps an account beneficiaries-only change to one beneficiaries PUT with a bare-array body", () => {
    const writes = baseWritesForChange(
      change("account", "acc-1", { beneficiaries: BENEFICIARIES }),
      CLIENT,
    );
    expect(writes).toEqual([
      {
        url: "/api/clients/client-1/accounts/acc-1/beneficiaries",
        method: "PUT",
        body: BENEFICIARIES,
      },
    ]);
  });

  it("maps an account change with both fields to two writes, owners first", () => {
    const writes = baseWritesForChange(
      change("account", "acc-1", { owners: OWNERS, beneficiaries: BENEFICIARIES }),
      CLIENT,
    );
    expect(writes).toEqual([
      {
        url: "/api/clients/client-1/accounts/acc-1",
        method: "PUT",
        body: { owners: OWNERS },
      },
      {
        url: "/api/clients/client-1/accounts/acc-1/beneficiaries",
        method: "PUT",
        body: BENEFICIARIES,
      },
    ]);
  });

  it("maps an entity owners change to the entity PUT", () => {
    const writes = baseWritesForChange(change("entity", "ent-1", { owners: OWNERS }), CLIENT);
    expect(writes).toEqual([
      { url: "/api/clients/client-1/entities/ent-1", method: "PUT", body: { owners: OWNERS } },
    ]);
  });

  it("maps an entity beneficiaries change to the entity beneficiaries sub-route", () => {
    const writes = baseWritesForChange(
      change("entity", "ent-1", { beneficiaries: BENEFICIARIES }),
      CLIENT,
    );
    expect(writes).toEqual([
      {
        url: "/api/clients/client-1/entities/ent-1/beneficiaries",
        method: "PUT",
        body: BENEFICIARIES,
      },
    ]);
  });

  it("maps a will change to one will PATCH carrying both fields", () => {
    const bequests = [{ id: "bq-1", name: "House" }];
    const residuaryRecipients = [{ recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 }];
    const writes = baseWritesForChange(
      change("will", "will-1", { bequests, residuaryRecipients }),
      CLIENT,
    );
    expect(writes).toEqual([
      {
        url: "/api/clients/client-1/wills/will-1",
        method: "PATCH",
        body: { bequests, residuaryRecipients },
      },
    ]);
  });
});
