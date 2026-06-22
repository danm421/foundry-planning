import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { db } from "@/db";
import { intakeForms, auditLog } from "@/db/schema";
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

const requireActiveSubscriptionForFirmMock = vi.fn();
vi.mock("@/lib/authz", () => ({
  ForbiddenError,
  requireActiveSubscriptionForFirm: (firmId: string) =>
    requireActiveSubscriptionForFirmMock(firmId),
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

let draftToken: string;
let submittedToken: string;
let incompleteToken: string;
let inactiveToken: string;
const createdIds: string[] = [];

beforeAll(async () => {
  draftToken = newIntakeToken();
  submittedToken = newIntakeToken();
  incompleteToken = newIntakeToken();
  inactiveToken = newIntakeToken();

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

  it("429: rate-limit exceeded returns Too Many Requests", async () => {
    checkSubmitMock.mockResolvedValue({ allowed: false, reason: "exceeded" });

    const res = await POST(makeReq(draftToken), {
      params: Promise.resolve({ token: draftToken }),
    });
    expect(res.status).toBe(429);
  }, 30000);
});
