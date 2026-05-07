import { describe, it, expect } from "vitest";
import { applyAssetTabOp, type ApplyOpContext } from "../asset-tab-ops";
import type { AccountOwner } from "@/engine/ownership";

const CTX: ApplyOpContext = {
  entityId: "trust-1",
  familyMembers: [
    { id: "fm-c", role: "client" as const },
    { id: "fm-s", role: "spouse" as const },
  ],
};

const CTX_NO_SPOUSE: ApplyOpContext = {
  entityId: "trust-1",
  familyMembers: [{ id: "fm-c", role: "client" as const }],
};

function sum(owners: AccountOwner[]): number {
  return owners.reduce((s, o) => s + o.percent, 0);
}

function trustPct(owners: AccountOwner[], trustId = "trust-1"): number {
  const row = owners.find((o) => o.kind === "entity" && (o as { entityId: string }).entityId === trustId);
  return row ? row.percent : 0;
}

// ── remove ─────────────────────────────────────────────────────────────────────

describe("remove op", () => {
  it("removes trust row and proportionally redistributes freed % to existing FM rows", () => {
    const owners: AccountOwner[] = [
      { kind: "family_member", familyMemberId: "fm-c", percent: 0.4 },
      { kind: "family_member", familyMemberId: "fm-s", percent: 0.2 },
      { kind: "entity", entityId: "trust-1", percent: 0.4 },
    ];
    const result = applyAssetTabOp(owners, { type: "remove", assetType: "account", assetId: "a1" }, CTX);
    expect(result.find((o) => o.kind === "entity")).toBeUndefined();
    expect(Math.abs(sum(result) - 1)).toBeLessThan(0.0001);
    // Client had 0.4, spouse had 0.2 (sum 0.6). Freed 0.4 split proportionally: client 0.4+0.4*(2/3)≈0.667, spouse 0.2+0.4*(1/3)≈0.333
    const clientRow = result.find((o) => o.kind === "family_member" && (o as { familyMemberId: string }).familyMemberId === "fm-c");
    expect(clientRow?.percent).toBeCloseTo(2 / 3, 4);
  });

  it("removes only-trust-owner and reassigns 100% to client+spouse 50/50", () => {
    const owners: AccountOwner[] = [
      { kind: "entity", entityId: "trust-1", percent: 1.0 },
    ];
    const result = applyAssetTabOp(owners, { type: "remove", assetType: "account", assetId: "a1" }, CTX);
    expect(trustPct(result)).toBe(0);
    expect(result).toHaveLength(2);
    expect(Math.abs(sum(result) - 1)).toBeLessThan(0.0001);
    const clientRow = result.find((o) => o.kind === "family_member" && (o as { familyMemberId: string }).familyMemberId === "fm-c");
    expect(clientRow?.percent).toBeCloseTo(0.5, 4);
  });

  it("removes only-trust-owner and gives 100% to client when no spouse", () => {
    const owners: AccountOwner[] = [
      { kind: "entity", entityId: "trust-1", percent: 1.0 },
    ];
    const result = applyAssetTabOp(owners, { type: "remove", assetType: "account", assetId: "a1" }, CTX_NO_SPOUSE);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "family_member", familyMemberId: "fm-c", percent: 1.0 });
  });

  it("throws when no FM available to absorb freed %", () => {
    const ctxEmpty: ApplyOpContext = { entityId: "trust-1", familyMembers: [] };
    const owners: AccountOwner[] = [{ kind: "entity", entityId: "trust-1", percent: 1.0 }];
    expect(() => applyAssetTabOp(owners, { type: "remove", assetType: "account", assetId: "a1" }, ctxEmpty)).toThrow();
  });
});

// ── set-percent ────────────────────────────────────────────────────────────────

describe("set-percent op", () => {
  it("grows trust share and shrinks other rows proportionally", () => {
    const owners: AccountOwner[] = [
      { kind: "family_member", familyMemberId: "fm-c", percent: 0.6 },
      { kind: "family_member", familyMemberId: "fm-s", percent: 0.4 },
    ];
    // Add trust via set-percent (trust not yet in list — treated as starting at 0)
    const result = applyAssetTabOp(owners, { type: "set-percent", assetType: "account", assetId: "a1", percent: 40 }, CTX);
    expect(Math.abs(sum(result) - 1)).toBeLessThan(0.0001);
    expect(trustPct(result)).toBeCloseTo(0.4, 4);
  });

  it("updates existing trust row and rescales other rows", () => {
    const owners: AccountOwner[] = [
      { kind: "family_member", familyMemberId: "fm-c", percent: 0.5 },
      { kind: "entity", entityId: "trust-1", percent: 0.5 },
    ];
    const result = applyAssetTabOp(owners, { type: "set-percent", assetType: "account", assetId: "a1", percent: 80 }, CTX);
    expect(Math.abs(sum(result) - 1)).toBeLessThan(0.0001);
    expect(trustPct(result)).toBeCloseTo(0.8, 4);
    const clientRow = result.find((o) => o.kind === "family_member" && (o as { familyMemberId: string }).familyMemberId === "fm-c");
    expect(clientRow?.percent).toBeCloseTo(0.2, 4);
  });

  it("set-percent to 100% makes trust sole owner", () => {
    const owners: AccountOwner[] = [
      { kind: "family_member", familyMemberId: "fm-c", percent: 1.0 },
    ];
    const result = applyAssetTabOp(owners, { type: "set-percent", assetType: "account", assetId: "a1", percent: 100 }, CTX);
    expect(Math.abs(sum(result) - 1)).toBeLessThan(0.0001);
    expect(trustPct(result)).toBeCloseTo(1.0, 4);
  });
});

// ── add ────────────────────────────────────────────────────────────────────────

describe("add op", () => {
  it("inserts trust row at requested % and shrinks existing FM rows proportionally", () => {
    const owners: AccountOwner[] = [
      { kind: "family_member", familyMemberId: "fm-c", percent: 0.6 },
      { kind: "family_member", familyMemberId: "fm-s", percent: 0.4 },
    ];
    const result = applyAssetTabOp(owners, { type: "add", assetType: "account", assetId: "a1", percent: 50 }, CTX);
    expect(Math.abs(sum(result) - 1)).toBeLessThan(0.0001);
    expect(trustPct(result)).toBeCloseTo(0.5, 4);
  });

  it("add to all-household (100%) at 100% makes trust sole owner", () => {
    const owners: AccountOwner[] = [
      { kind: "family_member", familyMemberId: "fm-c", percent: 1.0 },
    ];
    const result = applyAssetTabOp(owners, { type: "add", assetType: "account", assetId: "a1", percent: 100 }, CTX);
    expect(Math.abs(sum(result) - 1)).toBeLessThan(0.0001);
    expect(trustPct(result)).toBeCloseTo(1.0, 4);
  });

  it("add when trust already exists delegates to set-percent", () => {
    const owners: AccountOwner[] = [
      { kind: "family_member", familyMemberId: "fm-c", percent: 0.5 },
      { kind: "entity", entityId: "trust-1", percent: 0.5 },
    ];
    const result = applyAssetTabOp(owners, { type: "add", assetType: "account", assetId: "a1", percent: 75 }, CTX);
    expect(Math.abs(sum(result) - 1)).toBeLessThan(0.0001);
    expect(trustPct(result)).toBeCloseTo(0.75, 4);
  });

  it("add with mixed owners (another entity + FM) shrinks all proportionally", () => {
    const owners: AccountOwner[] = [
      { kind: "family_member", familyMemberId: "fm-c", percent: 0.6 },
      { kind: "entity", entityId: "trust-2", percent: 0.4 },
    ];
    const result = applyAssetTabOp(owners, { type: "add", assetType: "account", assetId: "a1", percent: 20 }, CTX);
    expect(Math.abs(sum(result) - 1)).toBeLessThan(0.0001);
    expect(trustPct(result, "trust-1")).toBeCloseTo(0.2, 4);
  });
});

// ── C1: set-percent on trust-only-owned asset ─────────────────────────────────

describe("set-percent on trust-only-owned asset (C1)", () => {
  it("shrink trust from 100% to 50%: freed 50% redistributed to client+spouse 25/25", () => {
    const ctx: ApplyOpContext = {
      entityId: "trust-1",
      familyMembers: [
        { id: "fm-c", role: "client" as const },
        { id: "fm-s", role: "spouse" as const },
      ],
    };
    const result = applyAssetTabOp(
      [{ kind: "entity", entityId: "trust-1", percent: 1 }],
      { type: "set-percent", assetType: "account", assetId: "a1", percent: 50 },
      ctx,
    );
    const total = result.reduce((s, o) => s + o.percent, 0);
    expect(Math.abs(total - 1)).toBeLessThan(0.0001);
    const trustRow = result.find((o) => o.kind === "entity");
    expect(trustRow?.percent).toBeCloseTo(0.5, 4);
    // freed 50% split to client + spouse
    const clientRow = result.find((o) => o.kind === "family_member" && (o as { familyMemberId: string }).familyMemberId === "fm-c");
    const spouseRow = result.find((o) => o.kind === "family_member" && (o as { familyMemberId: string }).familyMemberId === "fm-s");
    expect(clientRow?.percent).toBeCloseTo(0.25, 4);
    expect(spouseRow?.percent).toBeCloseTo(0.25, 4);
  });

  it("shrink trust-only to 80%: freed 20% goes to client when no spouse", () => {
    const ctxClientOnly: ApplyOpContext = {
      entityId: "trust-1",
      familyMembers: [{ id: "fm-c", role: "client" as const }],
    };
    const result = applyAssetTabOp(
      [{ kind: "entity", entityId: "trust-1", percent: 1 }],
      { type: "set-percent", assetType: "account", assetId: "a1", percent: 80 },
      ctxClientOnly,
    );
    const total = result.reduce((s, o) => s + o.percent, 0);
    expect(Math.abs(total - 1)).toBeLessThan(0.0001);
    const trustRow = result.find((o) => o.kind === "entity");
    expect(trustRow?.percent).toBeCloseTo(0.8, 4);
    const clientRow = result.find((o) => o.kind === "family_member" && (o as { familyMemberId: string }).familyMemberId === "fm-c");
    expect(clientRow?.percent).toBeCloseTo(0.2, 4);
  });
});

// ── C2: remove with zero-pct FM rows ─────────────────────────────────────────

describe("remove with zero-pct FM rows (C2)", () => {
  it("falls back to client/spouse split when all FM rows are at 0%", () => {
    const ctx: ApplyOpContext = {
      entityId: "trust-1",
      familyMembers: [
        { id: "fm-c", role: "client" as const },
        { id: "fm-s", role: "spouse" as const },
      ],
    };
    const result = applyAssetTabOp(
      [
        { kind: "family_member", familyMemberId: "fm-c", percent: 0 },
        { kind: "family_member", familyMemberId: "fm-s", percent: 0 },
        { kind: "entity", entityId: "trust-1", percent: 1 },
      ],
      { type: "remove", assetType: "account", assetId: "a1" },
      ctx,
    );
    const total = result.reduce((s, o) => s + o.percent, 0);
    expect(Math.abs(total - 1)).toBeLessThan(0.0001);
    expect(result.every((o) => Number.isFinite(o.percent))).toBe(true);
    // zero-pct rows filtered out; fallback produces 0.5/0.5
    const clientRow = result.find((o) => o.kind === "family_member" && (o as { familyMemberId: string }).familyMemberId === "fm-c");
    const spouseRow = result.find((o) => o.kind === "family_member" && (o as { familyMemberId: string }).familyMemberId === "fm-s");
    expect(clientRow?.percent).toBeCloseTo(0.5, 4);
    expect(spouseRow?.percent).toBeCloseTo(0.5, 4);
  });

  it("zero-pct rows are filtered from all op outputs", () => {
    // After a set-percent that scales others down to 0, they should be dropped
    const owners: AccountOwner[] = [
      { kind: "family_member", familyMemberId: "fm-c", percent: 0 },
      { kind: "entity", entityId: "trust-1", percent: 1 },
    ];
    // set-percent to 100% — others scaled to 0, should be dropped
    const result = applyAssetTabOp(
      owners,
      { type: "set-percent", assetType: "account", assetId: "a1", percent: 100 },
      CTX,
    );
    expect(result.every((o) => o.percent > 0.0001)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "entity", entityId: "trust-1" });
  });
});
