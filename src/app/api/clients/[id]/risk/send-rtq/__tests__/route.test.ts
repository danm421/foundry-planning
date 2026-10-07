import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "advisor-1", orgId: "firm-1" }),
  currentUser: vi.fn().mockResolvedValue({
    firstName: "Jane",
    lastName: "Advisor",
    primaryEmailAddress: { emailAddress: "jane@acme.com" },
  }),
}));

vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: vi.fn().mockResolvedValue("firm-1"),
}));

vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: vi.fn().mockResolvedValue({
    firmId: "firm-1",
    access: "own",
    client: { id: "client-1", advisorId: "advisor-1" },
  }),
}));

vi.mock("@/lib/authz", () => ({
  requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined),
  authErrorResponse: vi.fn(() => null),
}));

// Both writes happen inside one transaction; recording the callback is enough
// to prove whether any questionnaire row was written.
const transactionMock = vi.hoisted(() => vi.fn());
vi.mock("@/db", () => ({ db: { transaction: transactionMock } }));

const sendEmailMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/risk/email", () => ({ sendRiskQuestionnaireEmail: sendEmailMock }));

vi.mock("@/lib/branding/advisor-profile", () => ({
  getAdvisorProfile: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/activity/resolve-firm-names", () => ({
  resolveFirmName: vi.fn().mockResolvedValue("Acme Wealth"),
}));

const recordAuditMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/audit", () => ({ recordAudit: recordAuditMock }));

const checkLimitMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit", () => ({ checkClientEmailRateLimit: checkLimitMock }));

import { POST } from "../route";
import { NextRequest } from "next/server";

const postReq = (body: unknown) =>
  new NextRequest("http://localhost/api/clients/client-1/risk/send-rtq", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({ id: "client-1" }) };

beforeEach(() => {
  transactionMock.mockReset();
  sendEmailMock.mockReset();
  recordAuditMock.mockReset();
  checkLimitMock.mockReset();

  transactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
    const tx = {
      update: () => ({ set: () => ({ where: async () => undefined }) }),
      insert: () => ({ values: async () => undefined }),
    };
    await cb(tx);
  });
  sendEmailMock.mockResolvedValue({ delivered: true });
  recordAuditMock.mockResolvedValue(undefined);
  checkLimitMock.mockResolvedValue({ allowed: true, remaining: 29, reset: 0 });
});

describe("POST /api/clients/[id]/risk/send-rtq — firm email budget", () => {
  it("refuses a send over the firm's email budget, before any questionnaire row or email", async () => {
    checkLimitMock.mockResolvedValue({ allowed: false, reason: "exceeded" });

    const res = await POST(
      postReq({ subject: "primary", recipientEmail: "sam@client.com" }),
      ctx,
    );

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Rate limit exceeded", reason: "exceeded" });
    expect(checkLimitMock).toHaveBeenCalledWith("firm-1");
    expect(transactionMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("refuses when the budget cannot be checked, rather than sending unmetered", async () => {
    checkLimitMock.mockResolvedValue({ allowed: false, reason: "redis_error" });

    const res = await POST(
      postReq({ subject: "primary", recipientEmail: "sam@client.com" }),
      ctx,
    );

    expect(res.status).toBe(429);
    expect(transactionMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("counts a send against the firm's email budget and still sends it within budget", async () => {
    const res = await POST(
      postReq({ subject: "spouse", recipientEmail: "casey@client.com", recipientName: "Casey" }),
      ctx,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, delivered: true });
    expect(checkLimitMock).toHaveBeenCalledTimes(1);
    expect(checkLimitMock).toHaveBeenCalledWith("firm-1");
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0]).toMatchObject({
      to: "casey@client.com",
      clientName: "Casey",
    });
  });

  it("does not spend the budget on a request it rejects as malformed", async () => {
    const res = await POST(postReq({ subject: "primary", recipientEmail: "not-an-email" }), ctx);

    expect(res.status).toBe(400);
    expect(checkLimitMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
