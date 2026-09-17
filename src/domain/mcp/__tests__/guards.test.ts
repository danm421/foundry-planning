import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocked one layer BELOW the guards, so the real
// `assertClientReadableForPrincipal` / `assertHouseholdReadableForPrincipal`
// bodies run. Everywhere else in this directory the household guard itself is
// doubled (`define-tool.test.ts`, `notes-tools.test.ts`), which left deleting
// its throw green across 9 test files — this file is the ratchet on the last
// link of the authorization chain. A plain factory per module is enough:
// `guards.ts` takes exactly one runtime binding from each, and doubling them
// here keeps `@/db` and Clerk out of the import graph entirely.
const { verifyClientAccessFor, verifyCrmHouseholdAccessFor } = vi.hoisted(() => ({
  verifyClientAccessFor: vi.fn(),
  verifyCrmHouseholdAccessFor: vi.fn(),
}));

vi.mock("@/lib/clients/authz", () => ({ verifyClientAccessFor }));
vi.mock("@/lib/crm/authz", () => ({ verifyCrmHouseholdAccessFor }));

import {
  assertClientReadableForPrincipal,
  assertHouseholdReadableForPrincipal,
  McpForbiddenError,
  CLIENT_UNREADABLE_MESSAGE,
} from "../guards";
import type { McpPrincipal } from "@/lib/mcp/principal";

const principal: McpPrincipal = {
  userId: "user_1",
  orgId: "org_1",
  orgRole: "org:member",
  scopes: [],
  tokenSubject: "user_1",
};

/**
 * The thrown value, or `undefined` if the guard resolved. Deleting a guard's
 * `throw` then fails on the instance assertion below rather than on a missing
 * rejection — an assertion, not a harness error.
 */
const rejection = (p: Promise<void>): Promise<unknown> =>
  p.then(
    () => undefined,
    (e: unknown) => e,
  );

beforeEach(() => {
  verifyClientAccessFor.mockReset();
  verifyCrmHouseholdAccessFor.mockReset();
});

describe("assertHouseholdReadableForPrincipal", () => {
  it("resolves when the household check says ok", async () => {
    verifyCrmHouseholdAccessFor.mockResolvedValue({ ok: true, firmId: "org_1", advisorId: "user_1" });
    await expect(assertHouseholdReadableForPrincipal(principal, "hh1")).resolves.toBeUndefined();
    // The firm is the token's, carried on the principal — never an argument
    // the model supplied.
    expect(verifyCrmHouseholdAccessFor).toHaveBeenCalledWith(principal, "hh1");
  });

  it("throws McpForbiddenError with the shared message when the check denies", async () => {
    verifyCrmHouseholdAccessFor.mockResolvedValue({ ok: false });
    const err = await rejection(assertHouseholdReadableForPrincipal(principal, "hh1"));
    expect(err).toBeInstanceOf(McpForbiddenError);
    expect((err as Error).message).toBe(CLIENT_UNREADABLE_MESSAGE);
  });
});

describe("assertClientReadableForPrincipal", () => {
  it("resolves when the client check says ok and the firm matches the token", async () => {
    verifyClientAccessFor.mockResolvedValue({
      ok: true, permission: "view", firmId: "org_1", access: "own",
    });
    await expect(assertClientReadableForPrincipal(principal, "c1")).resolves.toBeUndefined();
    expect(verifyClientAccessFor).toHaveBeenCalledWith(principal, "c1");
  });

  it("throws McpForbiddenError with the shared message when the check denies", async () => {
    verifyClientAccessFor.mockResolvedValue({ ok: false });
    const err = await rejection(assertClientReadableForPrincipal(principal, "c1"));
    expect(err).toBeInstanceOf(McpForbiddenError);
    expect((err as Error).message).toBe(CLIENT_UNREADABLE_MESSAGE);
  });

  // The second condition the household gate does not have: a cross-firm share
  // can answer `ok: true` carrying another firm's id. An MCP session is scoped
  // to the token's firm, so that is still unreadable here.
  it("throws when the check says ok but for a different firm than the token", async () => {
    verifyClientAccessFor.mockResolvedValue({
      ok: true, permission: "view", firmId: "org_OTHER", access: "shared",
    });
    const err = await rejection(assertClientReadableForPrincipal(principal, "c1"));
    expect(err).toBeInstanceOf(McpForbiddenError);
    expect((err as Error).message).toBe(CLIENT_UNREADABLE_MESSAGE);
  });
});

describe("the two guards together", () => {
  // Existence must never leak: a denied household, a missing one, and a
  // household id passed where a clientId belongs all read identically.
  it("raise the identical message", async () => {
    verifyCrmHouseholdAccessFor.mockResolvedValue({ ok: false });
    verifyClientAccessFor.mockResolvedValue({ ok: false });
    const household = await rejection(assertHouseholdReadableForPrincipal(principal, "hh1"));
    const client = await rejection(assertClientReadableForPrincipal(principal, "c1"));
    // Instance first: a guard that stopped throwing then fails HERE, on an
    // assertion, rather than on a TypeError reading `.message` off undefined.
    expect(household).toBeInstanceOf(McpForbiddenError);
    expect(client).toBeInstanceOf(McpForbiddenError);
    expect((household as Error).message).toBe(CLIENT_UNREADABLE_MESSAGE);
    expect((client as Error).message).toBe((household as Error).message);
  });
});
