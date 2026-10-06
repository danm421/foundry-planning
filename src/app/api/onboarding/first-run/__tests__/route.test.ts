// src/app/api/onboarding/first-run/__tests__/route.test.ts
//
// PATCH /api/onboarding/first-run, mocked at the lib boundary so it runs
// without a database. Asserts the scope handed to each write — the caller's
// own (orgId, userId), never anything from the body.

import { describe, it, expect, vi, beforeEach } from "vitest";

const requireOrgAndUserMock = vi.fn();
vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>("@/lib/db-helpers");
  return { ...actual, requireOrgAndUser: () => requireOrgAndUserMock() };
});

const markFirstRunStartedMock = vi.fn();
const dismissFirstRunMock = vi.fn();
const dismissWelcomeVideoMock = vi.fn();
vi.mock("@/lib/onboarding/advisor-first-run", () => ({
  markFirstRunStarted: (...a: unknown[]) => markFirstRunStartedMock(...a),
  dismissFirstRun: (...a: unknown[]) => dismissFirstRunMock(...a),
  dismissWelcomeVideo: (...a: unknown[]) => dismissWelcomeVideoMock(...a),
}));

const recordAuditMock = vi.fn();
vi.mock("@/lib/audit", () => ({ recordAudit: (a: unknown) => recordAuditMock(a) }));

import { PATCH } from "../route";

const patch = (body: unknown) =>
  PATCH(
    new Request("http://localhost/api/onboarding/first-run", {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  requireOrgAndUserMock.mockResolvedValue({ orgId: "org_1", userId: "user_1" });
});

describe("PATCH /api/onboarding/first-run", () => {
  it("records the welcome video as seen for the caller only, and audits it", async () => {
    const res = await patch({ action: "dismiss_welcome_video" });

    expect(res.status).toBe(200);
    expect(dismissWelcomeVideoMock).toHaveBeenCalledWith("org_1", "user_1");
    expect(dismissFirstRunMock).not.toHaveBeenCalled();
    expect(recordAuditMock).toHaveBeenCalledWith({
      action: "advisor_onboarding.welcome_video_dismiss",
      resourceType: "advisor_onboarding",
      resourceId: "user_1",
      firmId: "org_1",
    });
  });

  it("still dismisses the first-run card", async () => {
    const res = await patch({ action: "dismiss" });

    expect(res.status).toBe(200);
    expect(dismissFirstRunMock).toHaveBeenCalledWith("org_1", "user_1");
    expect(dismissWelcomeVideoMock).not.toHaveBeenCalled();
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "advisor_onboarding.dismiss" }),
    );
  });

  it("rejects an unknown action without writing", async () => {
    const res = await patch({ action: "nope" });

    expect(res.status).toBe(400);
    expect(dismissWelcomeVideoMock).not.toHaveBeenCalled();
    expect(dismissFirstRunMock).not.toHaveBeenCalled();
    expect(markFirstRunStartedMock).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });
});
