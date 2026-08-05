import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { db } from "@/db";
import {
  intakeForms,
  auditLog,
  clients,
  crmHouseholds,
  crmHouseholdContacts,
  notifications,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { newIntakeToken, defaultExpiry } from "@/lib/intake/tokens";
import type { IntakePayload } from "@/lib/intake/schema";

// --- Rate-limit mock ---
const checkSubmitMock = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  extractClientIp: () => "127.0.0.1",
  checkIntakeSubmitRateLimit: (key: string) => checkSubmitMock(key),
  rateLimitErrorResponse: (rl: { reason: string; reset?: number }) => {
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: rl.reason === "exceeded" ? 429 : 503,
      headers: { "Content-Type": "application/json" },
    });
  },
}));

// --- ForbiddenError + requireActiveSubscriptionForFirm mock ---
const { ForbiddenError } = vi.hoisted(() => {
  class ForbiddenError extends Error {
    constructor(m?: string) {
      super(m);
      this.name = "ForbiddenError";
    }
  }
  return { ForbiddenError };
});

// Only the NoSession variant is stubbed, deliberately. This route is public, so
// reaching for the session-bound `requireActiveSubscriptionForFirm` is the bug
// that 500'd every real client submission; leaving it off the mock means that
// mistake reintroduces itself as an immediate `undefined is not a function`
// here rather than shipping green. This does NOT make the suite a gate on which
// helper is used — the mock replaces the module wholesale, so the real gate
// never runs. Verify that by POSTing the live endpoint with no session.
const requireActiveSubscriptionForFirmMock = vi.fn();
vi.mock("@/lib/authz", () => ({
  ForbiddenError,
  requireActiveSubscriptionForFirmNoSession: (firmId: string) =>
    requireActiveSubscriptionForFirmMock(firmId),
}));

// --- Identity gate mock ---
// The handler runs outside a Next request scope here, so the real cookie read
// would throw. Default to verified; the gate's own block is asserted below.
const gateVerifiedMock = vi.fn(async () => true);
vi.mock("@/lib/intake/gate-session", () => ({
  isGateVerified: () => gateVerifiedMock(),
}));

import { POST } from "@/app/api/intake/[token]/submit/route";

const FIRM = "test-firm-submit";
const now = new Date();

// A complete, intakeSubmitSchema-valid payload
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

// Incomplete payload — missing family.primary
const INCOMPLETE_PAYLOAD = {
  accounts: [],
  income: [],
};

const ADVISOR_ID = "advisor-token-submit-test";

let draftToken: string;
let submittedToken: string;
let incompleteToken: string;
let inactiveToken: string;
// A blank-mode invite that DOES carry a client — the mainline "send a form to
// an existing client" flow. This is the case that must notify the advisor.
let clientBearingToken: string;
let clientBearingId: string;
let householdId: string;
const createdIds: string[] = [];

beforeAll(async () => {
  draftToken = newIntakeToken();
  submittedToken = newIntakeToken();
  incompleteToken = newIntakeToken();
  inactiveToken = newIntakeToken();
  clientBearingToken = newIntakeToken();

  const [hh] = await db
    .insert(crmHouseholds)
    .values({ firmId: FIRM, advisorId: ADVISOR_ID, name: `Household ${Math.random()}` })
    .returning({ id: crmHouseholds.id });
  householdId = hh.id;

  await db.insert(crmHouseholdContacts).values({
    householdId: hh.id,
    role: "primary",
    firstName: "Jane",
    lastName: "Smith",
  });

  const [client] = await db
    .insert(clients)
    .values({
      firmId: FIRM,
      advisorId: ADVISOR_ID,
      crmHouseholdId: hh.id,
      retirementAge: 65,
      planEndAge: 95,
    })
    .returning({ id: clients.id });
  clientBearingId = client.id;

  const rows = await db
    .insert(intakeForms)
    .values([
      {
        firmId: FIRM,
        mode: "blank",
        status: "draft",
        token: draftToken,
        recipientEmail: "draft@example.com",
        payload: COMPLETE_PAYLOAD,
        createdByUserId: "user-test",
        expiresAt: defaultExpiry(now),
      },
      {
        firmId: FIRM,
        mode: "blank",
        status: "submitted",
        token: submittedToken,
        recipientEmail: "already@example.com",
        payload: COMPLETE_PAYLOAD,
        createdByUserId: "user-test",
        expiresAt: defaultExpiry(now),
        submittedAt: now,
      },
      {
        firmId: FIRM,
        mode: "blank",
        status: "draft",
        token: incompleteToken,
        recipientEmail: "incomplete@example.com",
        payload: INCOMPLETE_PAYLOAD as unknown as IntakePayload,
        createdByUserId: "user-test",
        expiresAt: defaultExpiry(now),
      },
      {
        firmId: FIRM,
        mode: "blank",
        status: "draft",
        token: inactiveToken,
        recipientEmail: "inactive@example.com",
        payload: COMPLETE_PAYLOAD,
        createdByUserId: "user-test",
        expiresAt: defaultExpiry(now),
      },
      // Blank mode, but sent to an existing client — carries a clientId, so it
      // has an owning advisor to notify.
      {
        firmId: FIRM,
        mode: "blank",
        status: "draft",
        token: clientBearingToken,
        clientId: clientBearingId,
        recipientEmail: "client-bearing@example.com",
        recipientName: "The Johnsons",
        payload: COMPLETE_PAYLOAD,
        createdByUserId: "user-test",
        expiresAt: defaultExpiry(now),
      },
    ])
    .returning({ id: intakeForms.id });

  for (const row of rows) createdIds.push(row.id);
}, 30000);

afterAll(async () => {
  if (createdIds.length > 0) {
    // Clean up audit rows first
    await db
      .delete(auditLog)
      .where(and(eq(auditLog.firmId, FIRM), eq(auditLog.action, "intake.form.submitted")));
    await db.delete(intakeForms).where(eq(intakeForms.firmId, FIRM));
    // Clients before households — crm_household_id is ON DELETE RESTRICT.
    // Notification rows go with the client (client_id is ON DELETE CASCADE).
    await db.delete(clients).where(eq(clients.firmId, FIRM));
    if (householdId) {
      await db.delete(crmHouseholds).where(eq(crmHouseholds.id, householdId));
    }
  }
}, 30000);

function makeReq(token: string, body?: unknown) {
  if (body === undefined) {
    return new Request(`http://localhost/api/intake/${token}/submit`, {
      method: "POST",
    });
  }
  return new Request(`http://localhost/api/intake/${token}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/intake/[token]/submit", () => {
  beforeEach(() => {
    gateVerifiedMock.mockResolvedValue(true);
  });

  // Runs before the 200 case below, which flips draftToken to "submitted" —
  // this needs the row to still be a draft to prove the gate is what stopped it.
  it("401: an unverified caller cannot submit, and the form stays a draft", async () => {
    checkSubmitMock.mockResolvedValue({ allowed: true });
    requireActiveSubscriptionForFirmMock.mockResolvedValue(undefined);
    gateVerifiedMock.mockResolvedValue(false);

    const res = await POST(makeReq(draftToken), {
      params: Promise.resolve({ token: draftToken }),
    });
    expect(res.status).toBe(401);

    const rows = await db
      .select()
      .from(intakeForms)
      .where(eq(intakeForms.token, draftToken));
    expect(rows[0]?.status).toBe("draft");
    expect(rows[0]?.submittedAt).toBeNull();
  }, 30000);

  it("200: submits a draft with a complete stored payload (no body)", async () => {
    checkSubmitMock.mockResolvedValue({ allowed: true });
    requireActiveSubscriptionForFirmMock.mockResolvedValue(undefined);

    const res = await POST(makeReq(draftToken), {
      params: Promise.resolve({ token: draftToken }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    // Row updated to submitted
    const rows = await db
      .select()
      .from(intakeForms)
      .where(eq(intakeForms.token, draftToken));
    expect(rows[0]?.status).toBe("submitted");
    expect(rows[0]?.submittedAt).toBeTruthy();

    // Audit row written with actorKind:"client"
    const auditRows = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.firmId, FIRM),
          eq(auditLog.action, "intake.form.submitted"),
        ),
      );
    expect(auditRows.length).toBeGreaterThan(0);
    expect(auditRows[0]?.actorKind).toBe("client");
  }, 30000);

  it("409: resubmit returns Conflict", async () => {
    checkSubmitMock.mockResolvedValue({ allowed: true });
    requireActiveSubscriptionForFirmMock.mockResolvedValue(undefined);

    const res = await POST(makeReq(submittedToken), {
      params: Promise.resolve({ token: submittedToken }),
    });
    expect(res.status).toBe(409);
  }, 30000);

  it("403: firm with inactive subscription returns Forbidden", async () => {
    checkSubmitMock.mockResolvedValue({ allowed: true });
    requireActiveSubscriptionForFirmMock.mockRejectedValue(
      new ForbiddenError("Active subscription required"),
    );

    const res = await POST(makeReq(inactiveToken), {
      params: Promise.resolve({ token: inactiveToken }),
    });
    expect(res.status).toBe(403);
  }, 30000);

  it("422: draft with incomplete stored payload returns Unprocessable Entity", async () => {
    checkSubmitMock.mockResolvedValue({ allowed: true });
    requireActiveSubscriptionForFirmMock.mockResolvedValue(undefined);

    const res = await POST(makeReq(incompleteToken), {
      params: Promise.resolve({ token: incompleteToken }),
    });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.issues).toBeDefined();
  }, 30000);

  it("404: unknown token returns Not Found", async () => {
    checkSubmitMock.mockResolvedValue({ allowed: true });

    const res = await POST(makeReq(newIntakeToken()), {
      params: Promise.resolve({ token: newIntakeToken() }),
    });
    expect(res.status).toBe(404);
  }, 30000);

  // The end-to-end proof for the emailed-link flow: this is the route the
  // "send a form to a client from /data-collection" invite actually posts to,
  // so a submission here must reach the owning advisor's inbox. Exercises the
  // real chain — route → producer → enqueue → prefs merge → planner → insert.
  it("200: a blank invite carrying a client notifies the owning advisor", async () => {
    checkSubmitMock.mockResolvedValue({ allowed: true });
    requireActiveSubscriptionForFirmMock.mockResolvedValue(undefined);

    const res = await POST(makeReq(clientBearingToken), {
      params: Promise.resolve({ token: clientBearingToken }),
    });
    expect(res.status).toBe(200);

    const [form] = await db
      .select({ id: intakeForms.id })
      .from(intakeForms)
      .where(eq(intakeForms.token, clientBearingToken));

    // Scoped by the per-run client uuid, not the static firm/advisor ids, so an
    // interrupted earlier run can't strand a row and make this count flaky.
    const notifRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.clientId, clientBearingId));
    expect(notifRows.length).toBe(1);
    expect(notifRows[0]?.firmId).toBe(FIRM);
    expect(notifRows[0]?.userId).toBe(ADVISOR_ID);
    expect(notifRows[0]?.category).toBe("intake_submitted");
    expect(notifRows[0]?.entityId).toBe(form?.id);
    expect(notifRows[0]?.url).toBe(`/data-collection/${form?.id}`);
    expect(notifRows[0]?.title).toContain("The Johnsons");
    // The client submitted it, so no actor is excluded from delivery.
    expect(notifRows[0]?.actorUserId).toBeNull();
    expect(notifRows[0]?.inApp).toBe(true);
  }, 30000);

  // A true prospect has no client and therefore no owning advisor. Notably the
  // invite EMAIL falls back to the sender in this case (see data-collection
  // route), and the notification deliberately does not — a prospect submission
  // must not manufacture a recipient.
  it("a prospect invite with no client writes no notification", async () => {
    // draftToken's form carries no clientId and was submitted by the first test.
    const [form] = await db
      .select({ id: intakeForms.id, clientId: intakeForms.clientId, status: intakeForms.status })
      .from(intakeForms)
      .where(eq(intakeForms.token, draftToken));
    // Guard the premise: a non-null clientId here would make this vacuous.
    expect(form?.clientId).toBeNull();
    expect(form?.status).toBe("submitted");

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, form!.id));
    expect(rows.length).toBe(0);
  }, 30000);

  it("429: rate-limit exceeded returns Too Many Requests", async () => {
    checkSubmitMock.mockResolvedValue({ allowed: false, reason: "exceeded" });

    const res = await POST(makeReq(draftToken), {
      params: Promise.resolve({ token: draftToken }),
    });
    expect(res.status).toBe(429);
  }, 30000);
});
