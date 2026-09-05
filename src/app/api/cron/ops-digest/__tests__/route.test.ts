import { describe, it, expect, beforeEach, vi } from "vitest";
import type { GrowthInput } from "@/lib/ops/growth/types";
import type { AttentionRow } from "@/lib/ops/growth/attention";

// Mutable fixtures the mocks below read from — reset in beforeEach so tests
// don't leak state into each other.
let attentionRows: AttentionRow[] = [];
let digestResult: { subject: string; text: string } | null = null;
const loadGrowthInputMock = vi.fn().mockResolvedValue({} as GrowthInput);
const sendOpsDigestMock = vi.fn().mockResolvedValue({ delivered: true });

// buildAttention and buildDigest are asserted only through their downstream
// effect (what the route does with the rows/mail they return), so the mocks
// below just hand back the fixtures rather than tracking call args.
vi.mock("@/lib/ops/growth/load", () => ({
  loadGrowthInput: () => loadGrowthInputMock(),
}));
vi.mock("@/lib/ops/growth/attention", () => ({
  buildAttention: () => attentionRows,
}));
vi.mock("@/lib/ops/growth/digest", () => ({
  buildDigest: () => digestResult,
}));
vi.mock("@/lib/ops/growth/email", () => ({
  sendOpsDigest: (args: { subject: string; text: string }) => sendOpsDigestMock(args),
}));

import { GET } from "../route";

function req(auth?: string): Request {
  return new Request("https://example.com/api/cron/ops-digest", {
    headers: auth ? { authorization: auth } : {},
  });
}

function row(overrides: Partial<AttentionRow> = {}): AttentionRow {
  return {
    kind: "trial_ending",
    headline: "Trial ends in 2 days",
    who: "Acme",
    email: null,
    firmId: "org_1",
    at: "2026-09-06T12:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  process.env.CRON_SECRET = "secret_t";
  attentionRows = [];
  digestResult = null;
  loadGrowthInputMock.mockClear();
  sendOpsDigestMock.mockReset().mockResolvedValue({ delivered: true });
});

describe("GET /api/cron/ops-digest", () => {
  it("401s without an authorization header", async () => {
    expect((await GET(req() as never)).status).toBe(401);
  });

  it("401s on a wrong secret", async () => {
    expect((await GET(req("Bearer nope") as never)).status).toBe(401);
  });

  it("401s when CRON_SECRET is unset even with a 'Bearer ' header", async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(req("Bearer ") as never)).status).toBe(401);
  });

  it("sends nothing on a quiet day — buildDigest returning null must not reach the transport", async () => {
    attentionRows = [];
    digestResult = null; // buildDigest's real behavior on an empty attention list

    const res = await GET(req("Bearer secret_t") as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ rows: 0, sent: false, reason: "quiet" });
    expect(sendOpsDigestMock).not.toHaveBeenCalled();
  });

  it("sends the digest and reports delivery when there is something to say", async () => {
    attentionRows = [row(), row({ kind: "canceled", headline: "Cancelled" })];
    digestResult = { subject: "Foundry: 2 things need you", text: "body" };

    const res = await GET(req("Bearer secret_t") as never);

    expect(res.status).toBe(200);
    expect(sendOpsDigestMock).toHaveBeenCalledWith(digestResult);
    await expect(res.json()).resolves.toEqual({ rows: 2, sent: true });
  });

  it("reports sent: false when the transport fails to deliver", async () => {
    attentionRows = [row()];
    digestResult = { subject: "Foundry: 1 thing needs you", text: "body" };
    sendOpsDigestMock.mockResolvedValue({ delivered: false });

    const res = await GET(req("Bearer secret_t") as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ rows: 1, sent: false });
  });

  it("calls loadGrowthInput with no arguments — page and cron must read the same data path", async () => {
    attentionRows = [row()];
    digestResult = { subject: "x", text: "y" };

    await GET(req("Bearer secret_t") as never);

    expect(loadGrowthInputMock).toHaveBeenCalledWith();
  });
});
