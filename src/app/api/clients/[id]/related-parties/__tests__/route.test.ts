// src/app/api/clients/[id]/related-parties/__tests__/route.test.ts
//
// The client-keyed write pair for `crm_household_contacts`. Mocking style is
// lifted from the map-pass route's test: `eq`/`and` become plain descriptors
// carrying the SQL column NAME, and the `@/db` mock evaluates them against
// in-memory rows keyed by that same name. That is what makes the two tenant
// tests real — drop a leg from the PATCH predicate and it genuinely starts
// matching another household's contact, instead of a where-ignoring mock
// returning the same row either way.
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Gate-chain mocks ------------------------------------------------------
// NOT wholesale-mocked: the routes map errors to statuses through
// `authErrorResponse`, which discriminates by `instanceof`, so the real
// ForbiddenError/UnauthorizedError classes must survive the mock.
vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return { ...actual, requireActiveSubscriptionForFirm: vi.fn() };
});
vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>("@/lib/db-helpers");
  return { ...actual, requireOrgAndUser: vi.fn() };
});
vi.mock("@/lib/clients/authz", () => ({ requireClientEditAccess: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

// --- Predicate-evaluating drizzle + @/db mocks -----------------------------
// The mocks record the TABLE they were handed, not just the values: without
// that, retargeting a write at a different table passes every other assertion
// in this file.
type Cond =
  | { op: "and"; parts: Cond[] }
  | { op: "eq"; col: string; value: unknown }
  | undefined;

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: { name: string }, value: unknown) => ({ op: "eq", col: col.name, value }),
    and: (...parts: unknown[]) => ({ op: "and", parts: parts.filter(Boolean) }),
  };
});

function matches(cond: Cond, row: Record<string, unknown>): boolean {
  if (!cond) return true;
  if (cond.op === "and") return cond.parts.every((p) => matches(p, row));
  if (cond.op === "eq") return row[cond.col] === cond.value;
  return true;
}

/** Rows of `crm_household_contacts`, keyed by SQL column name. */
let contactTable: Record<string, unknown>[] = [];
let inserts: Array<{ table: string; values: Record<string, unknown> }> = [];
let updateCalls: Array<{ table: string; patch: Record<string, unknown>; matched: number }> = [];

/** The values of the single insert this route should have made. */
function insertedValues(): Record<string, unknown> {
  expect(inserts).toHaveLength(1);
  return inserts[0].values;
}

function seedTables() {
  contactTable = [
    // This client's household.
    { id: "party-1", household_id: "hh-1", role: "other", first_name: "Ada", last_name: "Byron" },
    // Same household, but the PRIMARY contact — the client themself. Reachable
    // only if the PATCH stops checking `role`.
    { id: "primary-1", household_id: "hh-1", role: "primary", first_name: "Cleo", last_name: "Doe" },
    // Another firm's household, its own external contact. Reachable only if the
    // PATCH stops checking `householdId`.
    { id: "party-other", household_id: "hh-OTHER", role: "other", first_name: "Grace", last_name: "Hopper" },
  ];
  inserts = [];
  updateCalls = [];
}

vi.mock("@/db", () => ({
  db: {
    insert: (table: Parameters<typeof getTableName>[0]) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ table: getTableName(table), values });
        return {
          returning: () =>
            Promise.resolve([{ id: "party-new", ...values }]),
        };
      },
    }),
    update: (table: Parameters<typeof getTableName>[0]) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: Cond) => {
          const hits = contactTable.filter((r) => matches(cond, r));
          updateCalls.push({ table: getTableName(table), patch, matched: hits.length });
          return {
            returning: () =>
              Promise.resolve(
                hits.map((r) => ({ id: r.id, householdId: r.household_id, role: r.role, ...patch })),
              ),
          };
        },
      }),
    }),
  },
}));

import { getTableName } from "drizzle-orm";
import { POST } from "../route";
import { PATCH } from "../[partyId]/route";
import { requireOrgAndUser, UnauthorizedError } from "@/lib/db-helpers";
import { requireActiveSubscriptionForFirm, ForbiddenError } from "@/lib/authz";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";
import { crmContactRoleEnum } from "@/db/schema";

function req(body: unknown, method: "POST" | "PATCH" = "POST") {
  return new Request("http://t/api/clients/client-1/related-parties", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ id: "client-1" }) };
const partyParams = (partyId: string) => ({
  params: Promise.resolve({ id: "client-1", partyId }),
});

/** The client row `requireClientEditAccess` hands back — `crmHouseholdId` on it
 *  is the ONLY household either route is allowed to touch. */
const OWN_ACCESS = {
  client: { id: "client-1", crmHouseholdId: "hh-1" },
  firmId: "org_1",
  access: "own" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  seedTables();
  vi.mocked(requireOrgAndUser).mockResolvedValue({ orgId: "org_1", userId: "user_1" });
  vi.mocked(requireActiveSubscriptionForFirm).mockResolvedValue(undefined);
  vi.mocked(requireClientEditAccess).mockResolvedValue(OWN_ACCESS as never);
});

describe("related-parties route — POST", () => {
  // The brief sketched this as a 404. It is a 403: `requireClientEditAccess`
  // throws `ForbiddenError` for both the missing and the denied client — one
  // message for both, so existence never leaks — and `authErrorResponse`, which
  // every sibling route under /api/clients/[id] shares, maps that to 403.
  // The binding half is that the caller is REFUSED and nothing is written.
  it("refuses a client the caller cannot edit, and writes nothing", async () => {
    vi.mocked(requireClientEditAccess).mockRejectedValueOnce(
      new ForbiddenError("Client not found or access denied"),
    );
    const res = await POST(req({ firstName: "Ada", lastName: "Byron" }), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Client not found or access denied" });
    expect(inserts).toHaveLength(0);
  });

  it("401s an unauthenticated caller, and writes nothing", async () => {
    vi.mocked(requireOrgAndUser).mockRejectedValueOnce(new UnauthorizedError());
    const res = await POST(req({ firstName: "Ada", lastName: "Byron" }), params);
    expect(res.status).toBe(401);
    expect(inserts).toHaveLength(0);
  });

  it("403s a firm without an active subscription, and writes nothing", async () => {
    vi.mocked(requireActiveSubscriptionForFirm).mockRejectedValueOnce(
      new ForbiddenError("Active subscription required"),
    );
    const res = await POST(req({ firstName: "Ada", lastName: "Byron" }), params);
    expect(res.status).toBe(403);
    expect(inserts).toHaveLength(0);
  });

  // THE TENANT TEST. "attacker-household" is a real, live household id — it
  // just is not this client's. The route resolves the household from the PATH
  // client's own row, so the body's copy must never reach the insert.
  it("writes against the client's own CRM household, never a supplied one", async () => {
    const res = await POST(
      req({ firstName: "Ada", lastName: "Byron", householdId: "attacker-household" }),
      params,
    );
    expect(res.status).toBe(201);
    expect(insertedValues().householdId).toBe("hh-1");
    expect(Object.values(insertedValues())).not.toContain("attacker-household");
  });

  // The hard constraint. `crm_household_contacts` allows exactly one `primary`
  // and one `spouse` per household, and both belong to the household surface —
  // a row read off a document must never contend for either slot.
  it("refuses a row that claims the primary slot, before the database sees it", async () => {
    const res = await POST(
      req({ firstName: "Ada", lastName: "Byron", role: "primary" }),
      params,
    );
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it("always stores role 'other', even when the body says nothing about it", async () => {
    await POST(req({ firstName: "Ada", lastName: "Byron" }), params);
    expect(insertedValues().role).toBe("other");
  });

  it("400s an invalid body and names the field that failed", async () => {
    const res = await POST(req({ firstName: "Ada" }), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "lastName: Last name is required" });
    expect(inserts).toHaveLength(0);
  });

  // Without this the harness cannot tell `crm_household_contacts` from any
  // other table: retargeting the insert satisfies every other assertion here,
  // because they all read the VALUES and never the destination.
  it("writes to crm_household_contacts and no other table", async () => {
    await POST(req({ firstName: "Ada", lastName: "Byron" }), params);
    expect(inserts.map((i) => i.table)).toEqual(["crm_household_contacts"]);
  });

  it("returns the created id so the review row can be stamped", async () => {
    const res = await POST(req({ firstName: "Ada", lastName: "Byron" }), params);
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ id: expect.any(String) });
  });

  it("stores the document's wording of the role and the rest of the contact", async () => {
    await POST(
      req({
        firstName: "Ada",
        lastName: "Byron",
        relationshipLabel: "Successor Trustee",
        email: "ada@example.com",
        employer: "Byron & Co",
      }),
      params,
    );
    expect(insertedValues()).toMatchObject({
      firstName: "Ada",
      lastName: "Byron",
      relationshipLabel: "Successor Trustee",
      email: "ada@example.com",
      employer: "Byron & Co",
      phone: null,
      mobile: null,
      occupation: null,
      notes: null,
    });
  });

  it("audits the create against the new contact", async () => {
    await POST(req({ firstName: "Ada", lastName: "Byron", relationshipLabel: "Trustee" }), params);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "related_party.create",
        resourceType: "crm_household_contact",
        resourceId: "party-new",
        clientId: "client-1",
        firmId: "org_1",
      }),
    );
  });

  it("does not audit a create that never happened", async () => {
    await POST(req({ firstName: "Ada" }), params);
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("related-parties route — PATCH", () => {
  it("updates a contact of this client's own household", async () => {
    const res = await PATCH(
      req({ relationshipLabel: "Successor Trustee" }, "PATCH"),
      partyParams("party-1"),
    );
    expect(res.status).toBe(200);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].matched).toBe(1);
    expect(updateCalls[0].patch).toMatchObject({ relationshipLabel: "Successor Trustee" });
  });

  // THE OWNERSHIP CHECK, first leg. `party-other` is a real, live contact — it
  // just belongs to another firm's household. Only scoping the update to the
  // household resolved from the PATH client refuses it.
  it("404s a partyId belonging to ANOTHER household, and writes nothing", async () => {
    const res = await PATCH(
      req({ relationshipLabel: "Trustee" }, "PATCH"),
      partyParams("party-other"),
    );
    expect(res.status).toBe(404);
    expect(updateCalls[0]?.matched ?? 0).toBe(0);
  });

  // Second leg. `primary-1` IS in this client's household — the client
  // themself. Editing it from here would let a document rewrite the client's
  // own name behind the household surface's back.
  it("404s a contact of this household whose role is not 'other'", async () => {
    const res = await PATCH(
      req({ firstName: "Mallory" }, "PATCH"),
      partyParams("primary-1"),
    );
    expect(res.status).toBe(404);
    expect(updateCalls[0]?.matched ?? 0).toBe(0);
  });

  // The refusal is right; a bare "not found" for a person the advisor is
  // looking at on the Household screen is not. `commitMapRow` renders this
  // text, so it has to say where the contact is actually edited — and it has to
  // cover every role the predicate refuses, `dependent` included, not just the
  // primary and the spouse.
  it("says where a household contact is edited instead of just 'not found'", async () => {
    const res = await PATCH(req({ firstName: "Mallory" }, "PATCH"), partyParams("primary-1"));
    expect(await res.json()).toEqual({
      error:
        "Related party not found — the household's own contacts (the client, their co-client and any dependants) are edited on the Household screen, not here.",
    });
    // Ratchet on the roles that sentence has to describe: the predicate refuses
    // every non-'other' value, so a fourth one appearing here means the wording
    // must be revisited rather than silently under-describing a case.
    expect(crmContactRoleEnum.enumValues.filter((role) => role !== "other")).toEqual([
      "primary",
      "spouse",
      "dependent",
    ]);
  });

  it("refuses a client the caller cannot edit, and writes nothing", async () => {
    vi.mocked(requireClientEditAccess).mockRejectedValueOnce(
      new ForbiddenError("Client not found or access denied"),
    );
    const res = await PATCH(req({ firstName: "Mallory" }, "PATCH"), partyParams("party-1"));
    expect(res.status).toBe(403);
    expect(updateCalls).toHaveLength(0);
  });

  // The body cannot move a row between households or promote it out of the
  // 'other' role: the update schema owns neither key, so both are dropped.
  it("ignores a householdId or role smuggled into the body", async () => {
    await PATCH(
      req(
        { firstName: "Ada", householdId: "attacker-household", role: "primary" },
        "PATCH",
      ),
      partyParams("party-1"),
    );
    expect(updateCalls[0].patch).not.toHaveProperty("householdId");
    expect(updateCalls[0].patch).not.toHaveProperty("role");
  });

  it("touches only the keys the body actually sent", async () => {
    await PATCH(req({ phone: "555-0100" }, "PATCH"), partyParams("party-1"));
    expect(Object.keys(updateCalls[0].patch).sort()).toEqual(["phone", "updatedAt"]);
  });

  it("updates crm_household_contacts and no other table", async () => {
    await PATCH(req({ relationshipLabel: "Trustee" }, "PATCH"), partyParams("party-1"));
    expect(updateCalls.map((u) => u.table)).toEqual(["crm_household_contacts"]);
  });

  /**
   * A body that parses to `{}` asks for no change. Performing it anyway wrote
   * `updatedAt`, answered 200 and filed a `related_party.update` audit row for
   * a change that never happened — and `commitMapRow` treats any 2xx as a
   * landed write, so the advisor's review row was stamped "committed" having
   * written nothing.
   *
   * NOT hypothetical: `buildWriteRequest`'s update leg builds its body from the
   * row's values, skipping every `writable: false` field, so a row whose
   * extracted keys are all non-writable produces exactly `{}`.
   *
   * 400, not 422: the repo already answers 400 for this exact case in three
   * places (`portal/settings`, `portal/transactions/[id]`, and the
   * `toggle-groups` PATCH, whose wording this borrows). 422 here is reserved
   * for input that was processed and yielded nothing usable — an OCR read, an
   * AI call — which is a different thing from a caller asking for nothing.
   */
  it("400s a PATCH that asks for nothing, and writes and audits nothing", async () => {
    const res = await PATCH(req({}, "PATCH"), partyParams("party-1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "PATCH body must include at least one field to update",
    });
    expect(updateCalls).toHaveLength(0);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  // The same refusal, reached the way it actually will be: every key the caller
  // sent is one the schema strips, so the parse succeeds into `{}`.
  it("400s a PATCH whose only keys are ones the schema strips", async () => {
    const res = await PATCH(
      req({ householdId: "attacker-household", role: "primary" }, "PATCH"),
      partyParams("party-1"),
    );
    expect(res.status).toBe(400);
    expect(updateCalls).toHaveLength(0);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("400s an invalid body and names the field that failed", async () => {
    const res = await PATCH(req({ firstName: "" }, "PATCH"), partyParams("party-1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "firstName: First name is required" });
    expect(updateCalls).toHaveLength(0);
  });

  it("audits the update against the contact it changed", async () => {
    await PATCH(req({ relationshipLabel: "Executor" }, "PATCH"), partyParams("party-1"));
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "related_party.update",
        resourceType: "crm_household_contact",
        resourceId: "party-1",
        clientId: "client-1",
        firmId: "org_1",
      }),
    );
  });

  it("does not audit an update that matched no row", async () => {
    await PATCH(req({ firstName: "Mallory" }, "PATCH"), partyParams("party-other"));
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
