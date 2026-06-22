import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { db } from "@/db";
import { intakeForms, auditLog, clients, crmHouseholds, crmHouseholdContacts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { newIntakeToken, defaultExpiry } from "@/lib/intake/tokens";
import type { IntakePayload } from "@/lib/intake/schema";

// ── Auth chain mocks ──────────────────────────────────────────────────────────
// Mirror the pattern from src/app/api/portal/family/__tests__/route.test.ts

const requirePortalMock = vi.fn();

vi.mock("@/lib/authz", () => ({
  requireClientPortalAccess: () => requirePortalMock(),
  ForbiddenError: class ForbiddenError extends Error {
    constructor(m?: string) {
      super(m ?? "Forbidden");
      this.name = "ForbiddenError";
    }
  },
  authErrorResponse: (e: unknown) => {
    if (!(e instanceof Error)) return null;
    if (e.message === "Unauthorized") return { status: 401 as const, body: { error: "Unauthorized" } };
    if (e.name === "ForbiddenError" || e.message.startsWith("Forbidden")) {
      return { status: 403 as const, body: { error: e.message } };
    }
    return null;
  },
}));

vi.mock("@/lib/portal/require-portal-subscription", () => ({
  requirePortalActiveSubscription: () => Promise.resolve(),
}));

// ── snapshot mock ─────────────────────────────────────────────────────────────
const snapshotMock = vi.fn();
vi.mock("@/lib/intake/snapshot", () => ({
  snapshotClientToPayload: (...args: unknown[]) => snapshotMock(...args),
}));

import { GET, PATCH, POST } from "@/app/api/portal/intake/route";

// ── Shared constants ──────────────────────────────────────────────────────────

const FIRM_ID = "test-firm-portal-intake";
const ADVISOR_ID = "advisor-portal-intake-test";
const now = new Date();

const COMPLETE_PAYLOAD: IntakePayload = {
  family: {
    primary: {
      firstName: "Jane",
      lastName: "Smith",
      dateOfBirth: "1980-04-15",
      maritalStatus: "single",
    },
    spouse: null,
    stateOfResidence: "CA",
    children: [],
  },
  accounts: [],
  income: [],
  property: [],
  goals: {},
  meta: { completedSections: [] },
};

const SEEDED_PAYLOAD: IntakePayload = {
  family: {
    primary: {
      firstName: "Seeded",
      lastName: "User",
      dateOfBirth: "1975-01-01",
      maritalStatus: "married",
    },
    spouse: null,
    stateOfResidence: "TX",
    children: [],
  },
  accounts: [],
  income: [],
  property: [],
  goals: {},
  meta: { completedSections: [] },
};

// ── Captured IDs (set in beforeAll) ──────────────────────────────────────────

let clientEmpty: string;   // has empty-payload form → tests lazy seed
let clientPatch: string;   // has complete draft → tests autosave
let clientPost: string;    // has complete draft → tests submit
let clientNoForm: string;  // no form at all → tests 404

const householdIds: string[] = [];
const formIds: string[] = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function seedClientAndHousehold(): Promise<string> {
  const [hh] = await db
    .insert(crmHouseholds)
    .values({ firmId: FIRM_ID, advisorId: ADVISOR_ID, name: `Household ${Math.random()}` })
    .returning({ id: crmHouseholds.id });
  householdIds.push(hh.id);

  await db.insert(crmHouseholdContacts).values({
    householdId: hh.id,
    role: "primary",
    firstName: "Jane",
    lastName: "Smith",
  });

  const [client] = await db
    .insert(clients)
    .values({
      firmId: FIRM_ID,
      advisorId: ADVISOR_ID,
      crmHouseholdId: hh.id,
      retirementAge: 65,
      planEndAge: 95,
    })
    .returning({ id: clients.id });

  return client.id;
}

beforeAll(async () => {
  // Four isolated clients, one per scenario
  clientEmpty  = await seedClientAndHousehold();
  clientPatch  = await seedClientAndHousehold();
  clientPost   = await seedClientAndHousehold();
  clientNoForm = await seedClientAndHousehold(); // no intake_forms row

  const rows = await db
    .insert(intakeForms)
    .values([
      // CLIENT_EMPTY → empty payload → triggers lazy seed on GET
      {
        firmId: FIRM_ID,
        clientId: clientEmpty,
        mode: "prefilled" as const,
        status: "draft" as const,
        token: newIntakeToken(),
        recipientEmail: "empty@example.com",
        payload: {} as unknown as IntakePayload,
        createdByUserId: "user-test",
        expiresAt: defaultExpiry(now),
      },
      // CLIENT_PATCH → complete draft → autosave tests
      {
        firmId: FIRM_ID,
        clientId: clientPatch,
        mode: "prefilled" as const,
        status: "draft" as const,
        token: newIntakeToken(),
        recipientEmail: "patch@example.com",
        payload: COMPLETE_PAYLOAD,
        createdByUserId: "user-test",
        expiresAt: defaultExpiry(now),
      },
      // CLIENT_POST → complete draft → submit tests
      {
        firmId: FIRM_ID,
        clientId: clientPost,
        mode: "prefilled" as const,
        status: "draft" as const,
        token: newIntakeToken(),
        recipientEmail: "submit@example.com",
        payload: COMPLETE_PAYLOAD,
        createdByUserId: "user-test",
        expiresAt: defaultExpiry(now),
      },
    ])
    .returning({ id: intakeForms.id });

  for (const row of rows) formIds.push(row.id);
}, 30000);

afterAll(async () => {
  // Audit rows first (FK order)
  await db
    .delete(auditLog)
    .where(and(eq(auditLog.firmId, FIRM_ID), eq(auditLog.action, "intake.form.submitted")));

  await db.delete(intakeForms).where(eq(intakeForms.firmId, FIRM_ID));
  await db.delete(clients).where(eq(clients.firmId, FIRM_ID));
  // crmHouseholdContacts cascade with household
  for (const hhId of householdIds) {
    await db.delete(crmHouseholds).where(eq(crmHouseholds.id, hhId));
  }
}, 30000);

function makePatch(body: unknown) {
  return new Request("http://localhost/api/portal/intake", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makePost(body?: unknown) {
  if (body === undefined) {
    return new Request("http://localhost/api/portal/intake", { method: "POST" });
  }
  return new Request("http://localhost/api/portal/intake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── GET tests ─────────────────────────────────────────────────────────────────

describe("GET /api/portal/intake", () => {
  it("seeds empty payload via snapshotClientToPayload and persists it", async () => {
    requirePortalMock.mockResolvedValue({ clientId: clientEmpty });
    snapshotMock.mockResolvedValue(SEEDED_PAYLOAD);

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();

    // Snapshot was called with correct args
    expect(snapshotMock).toHaveBeenCalledWith(clientEmpty, FIRM_ID);

    // Returned payload matches what snapshot returned
    expect(json.payload).toMatchObject({ family: { primary: { firstName: "Seeded" } } });

    // DB row was persisted with the seeded payload
    const [row] = await db
      .select({ payload: intakeForms.payload })
      .from(intakeForms)
      .where(eq(intakeForms.clientId, clientEmpty));
    expect((row?.payload as IntakePayload | undefined)?.family?.primary?.firstName).toBe("Seeded");
  }, 30000);

  it("returns 404 when no active prefilled form exists for the client", async () => {
    // Real client in DB but with no intake_forms row
    requirePortalMock.mockResolvedValue({ clientId: clientNoForm });

    const res = await GET();
    expect(res.status).toBe(404);
  }, 30000);
});

// ── PATCH tests ───────────────────────────────────────────────────────────────

describe("PATCH /api/portal/intake (autosave)", () => {
  it("200: merges partial draft and persists it", async () => {
    requirePortalMock.mockResolvedValue({ clientId: clientPatch });

    const patch = { meta: { currentSection: "accounts", completedSections: ["family"] } };
    const res = await PATCH(makePatch(patch));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    // Verify persisted in DB
    const [row] = await db
      .select({ payload: intakeForms.payload })
      .from(intakeForms)
      .where(eq(intakeForms.clientId, clientPatch));
    const payload = row?.payload as IntakePayload | undefined;
    expect(payload?.meta?.currentSection).toBe("accounts");
  }, 30000);
});

// ── POST tests ────────────────────────────────────────────────────────────────

describe("POST /api/portal/intake (submit)", () => {
  it("200: submits complete draft, flips status→submitted, writes audit with actorKind:client", async () => {
    requirePortalMock.mockResolvedValue({ clientId: clientPost });

    const res = await POST(makePost());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    // Row updated
    const [row] = await db
      .select({ status: intakeForms.status, submittedAt: intakeForms.submittedAt })
      .from(intakeForms)
      .where(eq(intakeForms.clientId, clientPost));
    expect(row?.status).toBe("submitted");
    expect(row?.submittedAt).toBeTruthy();

    // Audit row with actorKind:"client"
    const auditRows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.firmId, FIRM_ID), eq(auditLog.action, "intake.form.submitted")));
    expect(auditRows.length).toBeGreaterThan(0);
    expect(auditRows[0]?.actorKind).toBe("client");
  }, 30000);

  it("409: resubmit after submit returns Conflict", async () => {
    requirePortalMock.mockResolvedValue({ clientId: clientPost });

    // Form is now "submitted" from prior test — POST again should 409
    const res = await POST(makePost());
    expect(res.status).toBe(409);
  }, 30000);
});

// ── Auth guard ────────────────────────────────────────────────────────────────

describe("Auth guard", () => {
  it("403 when requireClientPortalAccess throws a ForbiddenError", async () => {
    const err = new Error("Forbidden: No portal binding for this user");
    err.name = "ForbiddenError";
    requirePortalMock.mockRejectedValue(err);

    const res = await GET();
    expect(res.status).toBe(403);
  }, 30000);
});
