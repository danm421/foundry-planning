import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { db } from "@/db";
import { intakeForms } from "@/db/schema";
import { eq } from "drizzle-orm";
import { newIntakeToken, defaultExpiry } from "@/lib/intake/tokens";
import type { IntakePayload } from "@/lib/intake/schema";

// --- Rate-limit mock ---
const checkAutosaveMock = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  extractClientIp: () => "127.0.0.1",
  checkIntakeAutosaveRateLimit: (key: string) => checkAutosaveMock(key),
  rateLimitErrorResponse: (rl: { reason: string; reset?: number }) => {
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: rl.reason === "exceeded" ? 429 : 503,
      headers: { "Content-Type": "application/json" },
    });
  },
}));

import { PATCH } from "@/app/api/intake/[token]/route";

const FIRM = "test-firm-autosave";
const now = new Date();

// Token IDs (populated in beforeAll)
let draftToken: string;
let expiredToken: string;
let submittedToken: string;
const createdIds: string[] = [];

beforeAll(async () => {
  draftToken = newIntakeToken();
  expiredToken = newIntakeToken();
  submittedToken = newIntakeToken();

  const rows = await db
    .insert(intakeForms)
    .values([
      {
        firmId: FIRM,
        mode: "blank",
        status: "draft",
        token: draftToken,
        recipientEmail: "draft@example.com",
        payload: {} as unknown as IntakePayload,
        createdByUserId: "user-test",
        expiresAt: defaultExpiry(now),
      },
      {
        firmId: FIRM,
        mode: "blank",
        status: "draft",
        token: expiredToken,
        recipientEmail: "expired@example.com",
        payload: {} as unknown as IntakePayload,
        createdByUserId: "user-test",
        expiresAt: new Date(now.getTime() - 1000), // 1 second in the past
      },
      {
        firmId: FIRM,
        mode: "blank",
        status: "submitted",
        token: submittedToken,
        recipientEmail: "submitted@example.com",
        payload: {} as unknown as IntakePayload,
        createdByUserId: "user-test",
        expiresAt: defaultExpiry(now),
      },
    ])
    .returning({ id: intakeForms.id });

  for (const row of rows) createdIds.push(row.id);
}, 30000);

afterAll(async () => {
  if (createdIds.length > 0) {
    await db.delete(intakeForms).where(
      eq(intakeForms.firmId, FIRM),
    );
  }
}, 30000);

function makeReq(token: string, body: unknown) {
  return new Request(`http://localhost/api/intake/${token}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/intake/[token] — autosave", () => {
  it("200: persists a valid partial payload for a draft token", async () => {
    checkAutosaveMock.mockResolvedValue({ allowed: true });

    const payload = { meta: { currentSection: "family", completedSections: ["family"] } };
    const res = await PATCH(makeReq(draftToken, payload), {
      params: Promise.resolve({ token: draftToken }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    // Verify persisted
    const rows = await db
      .select()
      .from(intakeForms)
      .where(eq(intakeForms.token, draftToken));
    expect(rows[0]?.payload).toMatchObject({ meta: { currentSection: "family" } });
  }, 30000);

  it("410: expired token returns Gone", async () => {
    checkAutosaveMock.mockResolvedValue({ allowed: true });

    const res = await PATCH(makeReq(expiredToken, {}), {
      params: Promise.resolve({ token: expiredToken }),
    });
    expect(res.status).toBe(410);
  }, 30000);

  it("409: submitted token returns Conflict", async () => {
    checkAutosaveMock.mockResolvedValue({ allowed: true });

    const res = await PATCH(makeReq(submittedToken, {}), {
      params: Promise.resolve({ token: submittedToken }),
    });
    expect(res.status).toBe(409);
  }, 30000);

  it("404: unknown token returns Not Found", async () => {
    checkAutosaveMock.mockResolvedValue({ allowed: true });

    const unknownToken = newIntakeToken();
    const res = await PATCH(makeReq(unknownToken, {}), {
      params: Promise.resolve({ token: unknownToken }),
    });
    expect(res.status).toBe(404);
  }, 30000);

  it("422: invalid payload shape returns Unprocessable Entity", async () => {
    checkAutosaveMock.mockResolvedValue({ allowed: true });

    // goals.clientRetirementAge must be a number, not a string
    const badPayload = { goals: { clientRetirementAge: "not-a-number" } };
    const res = await PATCH(makeReq(draftToken, badPayload), {
      params: Promise.resolve({ token: draftToken }),
    });
    expect(res.status).toBe(422);
  }, 30000);

  it("429: rate-limit exceeded returns Too Many Requests", async () => {
    checkAutosaveMock.mockResolvedValue({ allowed: false, reason: "exceeded" });

    const res = await PATCH(makeReq(draftToken, {}), {
      params: Promise.resolve({ token: draftToken }),
    });
    expect(res.status).toBe(429);
  }, 30000);
});
