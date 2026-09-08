import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { TrialCancelCandidate } from "@/lib/billing/trial-feedback";

/**
 * The route is the state machine: who gets skipped, who gets written to, and
 * — the one that matters — when an audit row is stamped. That row is what
 * stops a second send, so it must appear only after a confirmed delivery.
 */

const h = vi.hoisted(() => ({
  find: vi.fn(),
  recipient: vi.fn(),
  send: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/billing/trial-feedback", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/trial-feedback")>();
  return {
    ...actual,
    findTrialCancellations: () => h.find(),
    // The real dedupe is covered in the lib test; here it is a pass-through so
    // each case controls its own candidate list.
    dropAlreadySent: async (c: TrialCancelCandidate[]) => c,
    resolveRecipient: (firmId: string) => h.recipient(firmId),
    sendTrialFeedbackEmail: (r: unknown) => h.send(r),
  };
});

vi.mock("@/lib/audit", () => ({ recordAudit: (a: unknown) => h.audit(a) }));

import { GET } from "../route";

function req(auth?: string): Request {
  return new Request("https://example.com/api/cron/trial-feedback", {
    headers: auth ? { authorization: auth } : {},
  });
}

function candidate(over: Partial<TrialCancelCandidate> = {}): TrialCancelCandidate {
  return {
    firmId: "org_1",
    firmName: "Acme Advisors",
    subscriptionId: "sub_1",
    canceledAt: new Date("2026-09-06T12:00:00.000Z"),
    ...over,
  };
}

const ENABLED = process.env.TRIAL_FEEDBACK_EMAIL_ENABLED;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "secret_t";
  process.env.TRIAL_FEEDBACK_EMAIL_ENABLED = "true";
  h.find.mockResolvedValue([]);
  h.recipient.mockResolvedValue({ email: "sarah@acme.com", firstName: "Sarah" });
  h.send.mockResolvedValue({ delivered: true });
  h.audit.mockResolvedValue(undefined);
});

afterEach(() => {
  if (ENABLED === undefined) delete process.env.TRIAL_FEEDBACK_EMAIL_ENABLED;
  else process.env.TRIAL_FEEDBACK_EMAIL_ENABLED = ENABLED;
});

describe("GET /api/cron/trial-feedback", () => {
  it("rejects a caller without the cron secret", async () => {
    const res = await GET(req() as never);
    expect(res.status).toBe(401);
    expect(h.find).not.toHaveBeenCalled();
  });

  it("rejects a wrong secret", async () => {
    expect((await GET(req("Bearer nope") as never)).status).toBe(401);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("sends nothing on a quiet hour", async () => {
    const body = await (await GET(req("Bearer secret_t") as never)).json();
    expect(body).toMatchObject({ pending: 0, sent: 0, results: [] });
    expect(h.send).not.toHaveBeenCalled();
  });

  it("writes to the contact and audits the send", async () => {
    h.find.mockResolvedValue([candidate()]);
    const body = await (await GET(req("Bearer secret_t") as never)).json();

    expect(h.send).toHaveBeenCalledWith({ email: "sarah@acme.com", firstName: "Sarah" });
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "billing.trial_feedback_sent",
        resourceType: "subscription",
        resourceId: "sub_1",
        firmId: "org_1",
        actorKind: "system",
      }),
    );
    expect(body).toMatchObject({ enabled: true, pending: 1, sent: 1 });
    expect(body.results[0]).toMatchObject({ to: "sarah@acme.com", outcome: "sent" });
  });

  it("does NOT audit a failed send, so the next run retries it", async () => {
    h.find.mockResolvedValue([candidate()]);
    h.send.mockResolvedValue({ delivered: false });
    const body = await (await GET(req("Bearer secret_t") as never)).json();

    expect(h.audit).not.toHaveBeenCalled();
    expect(body).toMatchObject({ sent: 0 });
    expect(body.results[0]).toMatchObject({ outcome: "failed" });
  });

  it("skips a firm with no reachable contact without failing the run", async () => {
    h.find.mockResolvedValue([candidate(), candidate({ firmId: "org_2", subscriptionId: "sub_2" })]);
    h.recipient.mockResolvedValueOnce(null);
    const body = await (await GET(req("Bearer secret_t") as never)).json();

    expect(body.results[0]).toMatchObject({ outcome: "no_contact", to: null });
    expect(body.results[1]).toMatchObject({ outcome: "sent" });
    expect(body.sent).toBe(1);
    expect(h.audit).toHaveBeenCalledTimes(1);
  });

  it("reports who it WOULD write to but sends nothing while disabled", async () => {
    delete process.env.TRIAL_FEEDBACK_EMAIL_ENABLED;
    h.find.mockResolvedValue([candidate()]);
    const body = await (await GET(req("Bearer secret_t") as never)).json();

    expect(h.send).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
    expect(body).toMatchObject({ enabled: false, pending: 1, sent: 0 });
    expect(body.results[0]).toMatchObject({ to: "sarah@acme.com", outcome: "dry_run" });
  });

  it("treats any value other than the literal true as disabled", async () => {
    process.env.TRIAL_FEEDBACK_EMAIL_ENABLED = "1";
    h.find.mockResolvedValue([candidate()]);
    const body = await (await GET(req("Bearer secret_t") as never)).json();
    expect(body.enabled).toBe(false);
    expect(h.send).not.toHaveBeenCalled();
  });
});
