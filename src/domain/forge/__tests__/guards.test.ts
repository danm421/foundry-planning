// src/domain/forge/__tests__/guards.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const verifyClientAccess = vi.fn<(clientId: string) => Promise<
  { ok: false } | { ok: true; permission: "view" | "edit"; firmId: string; access: "own" | "shared" }
>>();
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: (c: string) => verifyClientAccess(c) }));

// --- add at top, beside the existing verifyClientAccess mock ---
const findFirst = vi.fn();
vi.mock("@/db", () => ({ db: { query: { clients: { findFirst: (...a: unknown[]) => findFirst(...a) } } } }));

import { assertClientReadable, ForbiddenScopeError } from "../guards";
import type { ForgeAuthContext } from "../state";

const ctx: ForgeAuthContext = {
  userId: "u1",
  firmId: "org_A",
  clientId: "client-in-firm",
  scenarioId: "base",
};

beforeEach(() => verifyClientAccess.mockReset());

describe("assertClientReadable", () => {
  it("resolves when clientId matches the conversation scope and the firm grants access", async () => {
    verifyClientAccess.mockResolvedValue({ ok: true, permission: "edit", firmId: "org_A", access: "own" });
    await assertClientReadable(ctx, "client-in-firm"); // ctx.clientId === "client-in-firm"
    expect(verifyClientAccess).toHaveBeenCalledWith("client-in-firm");
  });
  it("throws ForbiddenScopeError for a clientId outside the conversation scope, before any DB call", async () => {
    await expect(assertClientReadable(ctx, "another-client")).rejects.toBeInstanceOf(ForbiddenScopeError);
    expect(verifyClientAccess).not.toHaveBeenCalled();
  });
  it("throws ForbiddenScopeError when the bound client fails the firm access check (cross-firm IDOR)", async () => {
    verifyClientAccess.mockResolvedValue({ ok: false });
    await expect(assertClientReadable(ctx, "client-in-firm")).rejects.toBeInstanceOf(ForbiddenScopeError);
    expect(verifyClientAccess).toHaveBeenCalledWith("client-in-firm");
  });
});

// --- add at bottom of the file ---
import { clientToHousehold, assertHouseholdReadable } from "../guards";

describe("clientToHousehold", () => {
  beforeEach(() => findFirst.mockReset());
  it("returns the household id for a client in the firm", async () => {
    findFirst.mockResolvedValue({ crmHouseholdId: "hh-1" });
    await expect(clientToHousehold("client-in-firm", "org_A")).resolves.toBe("hh-1");
  });
  it("throws ForbiddenScopeError when the client row is missing for the firm (cross-firm)", async () => {
    findFirst.mockResolvedValue(undefined);
    await expect(clientToHousehold("client-in-firm", "org_A")).rejects.toBeInstanceOf(ForbiddenScopeError);
  });
});

describe("assertHouseholdReadable", () => {
  beforeEach(() => { verifyClientAccess.mockReset(); findFirst.mockReset(); });
  it("resolves to the household after the client read-check passes", async () => {
    verifyClientAccess.mockResolvedValue({ ok: true, permission: "edit", firmId: "org_A", access: "own" });
    findFirst.mockResolvedValue({ crmHouseholdId: "hh-1" });
    await expect(assertHouseholdReadable(ctx)).resolves.toBe("hh-1");
    expect(verifyClientAccess).toHaveBeenCalledWith("client-in-firm");
  });
  it("rejects (before any household read) when the client fails the firm read-check", async () => {
    verifyClientAccess.mockResolvedValue({ ok: false });
    await expect(assertHouseholdReadable(ctx)).rejects.toBeInstanceOf(ForbiddenScopeError);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
