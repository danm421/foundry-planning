import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import type { GrowthInput } from "@/lib/ops/growth/types";
import type { AttentionRow } from "@/lib/ops/growth/attention";
import type { AccountRow } from "@/lib/ops/growth/accounts";
import type { ActivePersonRow } from "@/lib/ops/growth/active-people";

// Mutable fixtures the mocks below read from — reset in beforeEach so tests
// don't leak state into each other.
let attentionRows: AttentionRow[] = [];
let accountRows: AccountRow[] = [];
let peopleRows: ActivePersonRow[] = [];
let digestResult: { subject: string; text: string; html: string } | null = null;
const loadGrowthInputMock = vi.fn().mockResolvedValue({} as GrowthInput);
const sendOpsDigestMock = vi.fn().mockResolvedValue({ delivered: true });
// The route owns the dashboard URL it hands to buildDigest, so that argument
// IS the behavior under test — recorded rather than ignored.
type DigestArgs = {
  rows: AttentionRow[];
  accounts: AccountRow[];
  people: ActivePersonRow[];
  dashboardUrl: string;
};
const buildDigestMock = vi.fn<(args: DigestArgs) => typeof digestResult>(() => digestResult);

// buildAttention is asserted only through its downstream effect (what the
// route does with the rows it returns), so its mock just hands back the
// fixture rather than tracking call args.
vi.mock("@/lib/ops/growth/load", () => ({
  loadGrowthInput: () => loadGrowthInputMock(),
}));
vi.mock("@/lib/ops/growth/attention", () => ({
  buildAttention: () => attentionRows,
}));
vi.mock("@/lib/ops/growth/accounts", () => ({
  buildAccountRows: () => accountRows,
}));
vi.mock("@/lib/ops/growth/active-people", () => ({
  buildActivePeople: () => peopleRows,
}));
vi.mock("@/lib/ops/growth/digest", () => ({
  buildDigest: (args: DigestArgs) => buildDigestMock(args),
}));
vi.mock("@/lib/ops/growth/email", () => ({
  sendOpsDigest: (args: { subject: string; text: string; html?: string }) =>
    sendOpsDigestMock(args),
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

function person(overrides: Partial<ActivePersonRow> = {}): ActivePersonRow {
  return {
    firm: "Acme",
    name: "Ada Byron",
    clients: 7,
    daysActive: 5,
    lastSignInAt: "2026-09-13T08:30:00.000Z",
    actions: 42,
    ...overrides,
  };
}

function account(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    firm: "Acme",
    contactName: "Ada Byron",
    contactEmail: "ada@x.com",
    otherMembers: 0,
    trialDaysLeft: 10,
    canceled: null,
    canceledAt: null,
    ...overrides,
  };
}

// This file writes NEXT_PUBLIC_APP_URL, and process.env outlives a test file
// inside one vitest worker — restore whatever the environment actually had.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL;

beforeEach(() => {
  process.env.CRON_SECRET = "secret_t";
  attentionRows = [];
  accountRows = [];
  peopleRows = [];
  digestResult = null;
  loadGrowthInputMock.mockClear();
  buildDigestMock.mockClear();
  sendOpsDigestMock.mockReset().mockResolvedValue({ delivered: true });
});

afterEach(() => {
  if (APP_URL === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = APP_URL;
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
    accountRows = [];
    digestResult = null; // buildDigest's real behavior with nothing to report

    const res = await GET(req("Bearer secret_t") as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      rows: 0,
      accounts: 0,
      people: 0,
      sent: false,
      reason: "quiet",
    });
    expect(sendOpsDigestMock).not.toHaveBeenCalled();
  });

  it("sends the digest and reports delivery when there is something to say", async () => {
    attentionRows = [row(), row({ kind: "canceled", headline: "Canceled" })];
    accountRows = [account()];
    digestResult = { subject: "Foundry: 2 things need you", text: "body", html: "<p>body</p>" };

    const res = await GET(req("Bearer secret_t") as never);

    expect(res.status).toBe(200);
    // The HTML twin must reach the transport — a table sent as text/plain only
    // is the shape this digest was rewritten to stop producing.
    expect(sendOpsDigestMock).toHaveBeenCalledWith(digestResult);
    await expect(res.json()).resolves.toEqual({ rows: 2, accounts: 1, people: 0, sent: true });
  });

  it("reports sent: false when the transport fails to deliver", async () => {
    attentionRows = [row()];
    digestResult = { subject: "Foundry: 1 thing needs you", text: "body", html: "<p>body</p>" };
    sendOpsDigestMock.mockResolvedValue({ delivered: false });

    const res = await GET(req("Bearer secret_t") as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ rows: 1, accounts: 0, people: 0, sent: false });
  });

  it("strips a trailing slash off the app URL before linking the dashboard", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com/";
    attentionRows = [row()];
    digestResult = { subject: "x", text: "y", html: "<p>y</p>" };

    await GET(req("Bearer secret_t") as never);

    expect(buildDigestMock).toHaveBeenCalledWith({
      rows: attentionRows,
      accounts: accountRows,
      people: peopleRows,
      dashboardUrl: "https://app.example.com/admin/growth",
    });
  });

  it("leaves an app URL without a trailing slash alone", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    attentionRows = [row()];
    digestResult = { subject: "x", text: "y", html: "<p>y</p>" };

    await GET(req("Bearer secret_t") as never);

    expect(buildDigestMock).toHaveBeenCalledWith({
      rows: attentionRows,
      accounts: accountRows,
      people: peopleRows,
      dashboardUrl: "https://app.example.com/admin/growth",
    });
  });

  it("hands the active-people rows to buildDigest", async () => {
    attentionRows = [row()];
    peopleRows = [person(), person({ name: "Grace Hopper" })];
    digestResult = { subject: "x", text: "y", html: "<p>y</p>" };

    const res = await GET(req("Bearer secret_t") as never);

    expect(buildDigestMock.mock.calls[0][0].people).toEqual(peopleRows);
    await expect(res.json()).resolves.toEqual({ rows: 1, accounts: 0, people: 2, sent: true });
  });

  it("still sends nothing on a quiet day that had active people", async () => {
    // The people table must never be what keeps the daily email alive.
    peopleRows = [person()];
    digestResult = null;

    const res = await GET(req("Bearer secret_t") as never);

    await expect(res.json()).resolves.toEqual({
      rows: 0,
      accounts: 0,
      people: 1,
      sent: false,
      reason: "quiet",
    });
    expect(sendOpsDigestMock).not.toHaveBeenCalled();
  });

  it("calls loadGrowthInput with no arguments — page and cron must read the same data path", async () => {
    attentionRows = [row()];
    digestResult = { subject: "x", text: "y", html: "<p>y</p>" };

    await GET(req("Bearer secret_t") as never);

    expect(loadGrowthInputMock).toHaveBeenCalledWith();
  });
});
