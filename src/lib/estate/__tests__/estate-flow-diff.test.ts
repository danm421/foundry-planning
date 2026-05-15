import { describe, it, expect } from "vitest";
import { diffWorkingCopy } from "../estate-flow-diff";
import type { ClientData } from "@/engine/types";

// ---------------------------------------------------------------------------
// Minimal ClientData builder helpers
// ---------------------------------------------------------------------------

function cd(
  accounts: unknown[] = [],
  entities: unknown[] = [],
  wills: unknown[] = [],
): ClientData {
  return {
    accounts,
    entities,
    wills,
  } as unknown as ClientData;
}

const BASE_ACCOUNT = {
  id: "a1",
  name: "Checking",
  owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
  beneficiaries: [],
};

const BASE_ENTITY = {
  id: "e1",
  name: "Living Trust",
  owners: [{ familyMemberId: "fm-client", percent: 1 }],
  beneficiaries: [],
};

const BASE_WILL = {
  id: "w1",
  grantor: "client",
  bequests: [],
  residuaryRecipients: [],
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("diffWorkingCopy", () => {
  // ── No-change cases ──────────────────────────────────────────────────────

  it("returns no changes when both graphs are empty", () => {
    expect(diffWorkingCopy(cd(), cd())).toEqual([]);
  });

  it("returns no changes when the graphs are structurally equal", () => {
    const original = cd([{ ...BASE_ACCOUNT }]);
    const working = cd([{ ...BASE_ACCOUNT }]);
    expect(diffWorkingCopy(original, working)).toEqual([]);
  });

  it("returns no changes for a deep-equal array with new array identity (same content, different reference)", () => {
    // Same content in two freshly created arrays → should produce NO unit.
    const owners = [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }];
    const original = cd([{ ...BASE_ACCOUNT, owners: [...owners] }]);
    const working = cd([{ ...BASE_ACCOUNT, owners: [...owners] }]);
    expect(diffWorkingCopy(original, working)).toEqual([]);
  });

  // ── Account edits ────────────────────────────────────────────────────────

  it("emits one account edit carrying only the changed owners field", () => {
    const original = cd([
      { id: "a1", name: "Checking", owners: [{ kind: "family_member", familyMemberId: "x", percent: 1 }], beneficiaries: [] },
    ]);
    const working = cd([
      { id: "a1", name: "Checking", owners: [{ kind: "family_member", familyMemberId: "y", percent: 1 }], beneficiaries: [] },
    ]);
    const changes = diffWorkingCopy(original, working);
    expect(changes).toHaveLength(1);
    expect(changes[0].edit).toMatchObject({ op: "edit", targetKind: "account", targetId: "a1" });
    expect(Object.keys(changes[0].edit.desiredFields ?? {})).toEqual(["owners"]);
  });

  it("emits one account edit carrying only the changed beneficiaries field", () => {
    const beneficiary = { id: "b1", tier: "primary", percentage: 100, householdRole: "spouse", sortOrder: 0 };
    const original = cd([{ id: "a1", name: "Checking", owners: BASE_ACCOUNT.owners, beneficiaries: [] }]);
    const working = cd([{ id: "a1", name: "Checking", owners: BASE_ACCOUNT.owners, beneficiaries: [beneficiary] }]);
    const changes = diffWorkingCopy(original, working);
    expect(changes).toHaveLength(1);
    expect(changes[0].edit).toMatchObject({ op: "edit", targetKind: "account", targetId: "a1" });
    expect(Object.keys(changes[0].edit.desiredFields ?? {})).toEqual(["beneficiaries"]);
  });

  it("merges owners + beneficiaries changes on one account into a single edit", () => {
    const original = cd([
      { id: "a1", name: "Checking", owners: [{ kind: "family_member", familyMemberId: "x", percent: 1 }], beneficiaries: [] },
    ]);
    const working = cd([
      {
        id: "a1",
        name: "Checking",
        owners: [{ kind: "family_member", familyMemberId: "y", percent: 1 }],
        beneficiaries: [{ id: "b", tier: "primary", percentage: 100, householdRole: "spouse", sortOrder: 0 }],
      },
    ]);
    const changes = diffWorkingCopy(original, working);
    expect(changes).toHaveLength(1);
    expect(Object.keys(changes[0].edit.desiredFields ?? {}).sort()).toEqual(["beneficiaries", "owners"]);
  });

  it("skips an account present only in the working copy (add — not handled in v1)", () => {
    const original = cd([]);
    const working = cd([{ id: "a1", name: "New", owners: [], beneficiaries: [] }]);
    expect(diffWorkingCopy(original, working)).toEqual([]);
  });

  // ── Entity edits ─────────────────────────────────────────────────────────

  it("emits one entity edit when entity owners change", () => {
    const original = cd([], [
      { id: "e1", name: "Trust", owners: [{ familyMemberId: "fm-client", percent: 1 }], beneficiaries: [] },
    ]);
    const working = cd([], [
      { id: "e1", name: "Trust", owners: [{ familyMemberId: "fm-spouse", percent: 1 }], beneficiaries: [] },
    ]);
    const changes = diffWorkingCopy(original, working);
    expect(changes).toHaveLength(1);
    expect(changes[0].edit).toMatchObject({ op: "edit", targetKind: "entity", targetId: "e1" });
    expect(Object.keys(changes[0].edit.desiredFields ?? {})).toEqual(["owners"]);
  });

  it("emits one entity edit when entity beneficiaries change", () => {
    const beneficiary = { id: "b1", tier: "primary", percentage: 100, sortOrder: 0 };
    const original = cd([], [{ id: "e1", name: "Trust", owners: [], beneficiaries: [] }]);
    const working = cd([], [{ id: "e1", name: "Trust", owners: [], beneficiaries: [beneficiary] }]);
    const changes = diffWorkingCopy(original, working);
    expect(changes).toHaveLength(1);
    expect(changes[0].edit).toMatchObject({ op: "edit", targetKind: "entity", targetId: "e1" });
    expect(Object.keys(changes[0].edit.desiredFields ?? {})).toEqual(["beneficiaries"]);
  });

  // ── Will edits ───────────────────────────────────────────────────────────

  it("emits one will edit when bequests change", () => {
    const bequest = { id: "bq1", name: "House", kind: "asset", assetMode: "specific", accountId: "a1", liabilityId: null, percentage: 100, condition: "always", sortOrder: 0, recipients: [] };
    const original = cd([], [], [{ id: "w1", grantor: "client", bequests: [], residuaryRecipients: [] }]);
    const working = cd([], [], [{ id: "w1", grantor: "client", bequests: [bequest], residuaryRecipients: [] }]);
    const changes = diffWorkingCopy(original, working);
    expect(changes).toHaveLength(1);
    expect(changes[0].edit).toMatchObject({ op: "edit", targetKind: "will", targetId: "w1" });
    expect(changes[0].edit.desiredFields).toHaveProperty("bequests");
    expect(changes[0].edit.desiredFields).toHaveProperty("residuaryRecipients");
  });

  it("emits one will edit when residuaryRecipients change", () => {
    const recipient = { recipientKind: "family_member", recipientId: "fm1", percentage: 100, sortOrder: 0 };
    const original = cd([], [], [{ id: "w1", grantor: "client", bequests: [], residuaryRecipients: [] }]);
    const working = cd([], [], [{ id: "w1", grantor: "client", bequests: [], residuaryRecipients: [recipient] }]);
    const changes = diffWorkingCopy(original, working);
    expect(changes).toHaveLength(1);
    expect(changes[0].edit).toMatchObject({ op: "edit", targetKind: "will", targetId: "w1" });
  });

  it("skips a will with unchanged bequests and residuaryRecipients", () => {
    const original = cd([], [], [{ ...BASE_WILL }]);
    const working = cd([], [], [{ ...BASE_WILL }]);
    expect(diffWorkingCopy(original, working)).toEqual([]);
  });

  // ── Ordering ─────────────────────────────────────────────────────────────

  it("orders changes: accounts first, then entities, then wills", () => {
    const original = cd(
      [{ id: "a1", name: "Checking", owners: [{ kind: "family_member", familyMemberId: "x", percent: 1 }], beneficiaries: [] }],
      [{ id: "e1", name: "Trust", owners: [{ familyMemberId: "fm-client", percent: 1 }], beneficiaries: [] }],
      [{ id: "w1", grantor: "client", bequests: [], residuaryRecipients: [] }],
    );
    const working = cd(
      [{ id: "a1", name: "Checking", owners: [{ kind: "family_member", familyMemberId: "y", percent: 1 }], beneficiaries: [] }],
      [{ id: "e1", name: "Trust", owners: [{ familyMemberId: "fm-spouse", percent: 1 }], beneficiaries: [] }],
      [{ id: "w1", grantor: "client", bequests: [{ id: "bq1", name: "H", kind: "asset", assetMode: "all_assets", accountId: null, liabilityId: null, percentage: 100, condition: "always", sortOrder: 0, recipients: [] }], residuaryRecipients: [] }],
    );
    const changes = diffWorkingCopy(original, working);
    expect(changes).toHaveLength(3);
    expect(changes[0].edit.targetKind).toBe("account");
    expect(changes[1].edit.targetKind).toBe("entity");
    expect(changes[2].edit.targetKind).toBe("will");
  });

  // ── Description ──────────────────────────────────────────────────────────

  it("includes a human-readable description on each change", () => {
    const original = cd([{ id: "a1", name: "My IRA", owners: [{ kind: "family_member", familyMemberId: "x", percent: 1 }], beneficiaries: [] }]);
    const working = cd([{ id: "a1", name: "My IRA", owners: [{ kind: "family_member", familyMemberId: "y", percent: 1 }], beneficiaries: [] }]);
    const changes = diffWorkingCopy(original, working);
    expect(changes[0].description).toBeTruthy();
    expect(typeof changes[0].description).toBe("string");
  });
});
