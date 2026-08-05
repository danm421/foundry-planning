import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { db } from "@/db";
import { intakeForms } from "@/db/schema";
import { eq } from "drizzle-orm";
import { newIntakeToken, defaultExpiry } from "@/lib/intake/tokens";
import type { IntakePayload } from "@/lib/intake/schema";
import { gateCookieName, verifyGateSession } from "@/lib/intake/gate";

// --- Rate-limit mock ---
const checkVerifyMock = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  extractClientIp: () => "127.0.0.1",
  checkIntakeVerifyRateLimit: (key: string) => checkVerifyMock(key),
  rateLimitErrorResponse: (rl: { reason: string }) =>
    new Response(JSON.stringify({ error: "Too many requests" }), {
      status: rl.reason === "exceeded" ? 429 : 503,
      headers: { "Content-Type": "application/json" },
    }),
}));

// --- Audit mock (keeps the test off the audit table) ---
const recordAuditMock = vi.fn();
vi.mock("@/lib/audit", () => ({
  recordAudit: (args: unknown) => recordAuditMock(args as never),
}));

import { POST } from "@/app/api/intake/[token]/verify/route";

const FIRM = "test-firm-verify";
const now = new Date();

const EMAIL = "Jane.Client@Example.com";
const NAME = "Jane Client";

let draftToken: string;
let expiredToken: string;
let submittedToken: string;
let namelessToken: string;
let draftFormId: string;

beforeAll(async () => {
  process.env.INTAKE_GATE_SECRET = "test-gate-secret-do-not-use-in-prod";

  draftToken = newIntakeToken();
  expiredToken = newIntakeToken();
  submittedToken = newIntakeToken();
  namelessToken = newIntakeToken();

  const base = {
    firmId: FIRM,
    mode: "blank" as const,
    payload: {} as unknown as IntakePayload,
    createdByUserId: "user-test",
  };

  const rows = await db
    .insert(intakeForms)
    .values([
      {
        ...base,
        status: "draft",
        token: draftToken,
        recipientEmail: EMAIL,
        recipientName: NAME,
        expiresAt: defaultExpiry(now),
      },
      {
        ...base,
        status: "draft",
        token: expiredToken,
        recipientEmail: EMAIL,
        recipientName: NAME,
        expiresAt: new Date(now.getTime() - 1000),
      },
      {
        ...base,
        status: "submitted",
        token: submittedToken,
        recipientEmail: EMAIL,
        recipientName: NAME,
        expiresAt: defaultExpiry(now),
      },
      {
        ...base,
        status: "draft",
        token: namelessToken,
        recipientEmail: EMAIL,
        recipientName: null,
        expiresAt: defaultExpiry(now),
      },
    ])
    .returning({ id: intakeForms.id, token: intakeForms.token });

  draftFormId = rows.find((r) => r.token === draftToken)!.id;
}, 30000);

afterAll(async () => {
  await db.delete(intakeForms).where(eq(intakeForms.firmId, FIRM));
}, 30000);

function makeReq(token: string, body: unknown) {
  return new Request(`http://localhost/api/intake/${token}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const call = (token: string, body: unknown) =>
  POST(makeReq(token, body), { params: Promise.resolve({ token }) });

describe("POST /api/intake/[token]/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkVerifyMock.mockResolvedValue({ allowed: true });
  });

  it("200: correct surname + email mints a gate cookie for THIS form", async () => {
    const res = await call(draftToken, { lastName: "Client", email: EMAIL });
    expect(res.status).toBe(200);

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(gateCookieName(draftFormId));
    expect(setCookie.toLowerCase()).toContain("httponly");

    // The minted value must actually validate for this form.
    const value = decodeURIComponent(
      setCookie.split(`${gateCookieName(draftFormId)}=`)[1]!.split(";")[0]!,
    );
    expect(verifyGateSession(value, draftFormId)).toBe(true);
  }, 30000);

  it("200: match is case- and whitespace-insensitive", async () => {
    const res = await call(draftToken, {
      lastName: "  client ",
      email: "  jane.client@example.com  ",
    });
    expect(res.status).toBe(200);
  }, 30000);

  it("401: wrong surname is rejected and sets no cookie", async () => {
    const res = await call(draftToken, { lastName: "Wrong", email: EMAIL });
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  }, 30000);

  it("401: wrong email is rejected even with the right surname", async () => {
    const res = await call(draftToken, { lastName: "Client", email: "attacker@evil.com" });
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  }, 30000);

  // An attacker holding the link must not be able to tell which half they got
  // right — that would let them confirm the recipient's email independently.
  it("401: the failure message is identical for a wrong name and a wrong email", async () => {
    const wrongName = await (await call(draftToken, { lastName: "Wrong", email: EMAIL })).json();
    const wrongEmail = await (
      await call(draftToken, { lastName: "Client", email: "attacker@evil.com" })
    ).json();
    expect(wrongName.error).toBe(wrongEmail.error);
  }, 30000);

  it("401: a failed attempt is audited", async () => {
    await call(draftToken, { lastName: "Wrong", email: EMAIL });
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "intake.form.verify_failed" }),
    );
  }, 30000);

  it("200: falls back to email-only when the advisor stored no name", async () => {
    const res = await call(namelessToken, { lastName: "", email: EMAIL });
    expect(res.status).toBe(200);
  }, 30000);

  it("410: an expired link cannot be verified", async () => {
    const res = await call(expiredToken, { lastName: "Client", email: EMAIL });
    expect(res.status).toBe(410);
  }, 30000);

  it("409: an already-submitted form cannot be verified", async () => {
    const res = await call(submittedToken, { lastName: "Client", email: EMAIL });
    expect(res.status).toBe(409);
  }, 30000);

  it("404: unknown token", async () => {
    const res = await call("not-a-real-token", { lastName: "Client", email: EMAIL });
    expect(res.status).toBe(404);
  }, 30000);

  it("400: non-string fields are rejected", async () => {
    const res = await call(draftToken, { lastName: 42, email: EMAIL });
    expect(res.status).toBe(400);
  }, 30000);

  // Brute-force cap is keyed on the token alone, so rotating IPs doesn't reset it.
  it("429: rate limiting is keyed on the token, not the caller's IP", async () => {
    checkVerifyMock.mockResolvedValue({ allowed: false, reason: "exceeded" });
    const res = await call(draftToken, { lastName: "Client", email: EMAIL });
    expect(res.status).toBe(429);
    expect(checkVerifyMock).toHaveBeenCalledWith(draftToken);
  }, 30000);

  it("rate limit is checked BEFORE the identity comparison", async () => {
    checkVerifyMock.mockResolvedValue({ allowed: false, reason: "exceeded" });
    await call(draftToken, { lastName: "Client", email: EMAIL });
    // A guess that never reaches the comparison must not be audited as a
    // failed attempt, or the limiter would be self-defeating noise.
    expect(recordAuditMock).not.toHaveBeenCalled();
  }, 30000);
});
