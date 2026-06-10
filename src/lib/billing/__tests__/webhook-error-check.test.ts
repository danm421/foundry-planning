import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCountWhere = vi.fn();
vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => mockCountWhere() }) }) },
}));
vi.mock("@/db/schema", () => ({ billingEvents: { receivedAt: "received_at", result: "result" } }));

const mockCaptureMessage = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureMessage: (...a: unknown[]) => mockCaptureMessage(...a),
}));

import { checkRecentWebhookErrors } from "../webhook-error-check";

beforeEach(() => {
  mockCountWhere.mockReset();
  mockCaptureMessage.mockReset();
});

describe("checkRecentWebhookErrors", () => {
  it("returns the count and Sentry-alerts at error level when non-zero", async () => {
    mockCountWhere.mockResolvedValue([{ count: 4 }]);
    const count = await checkRecentWebhookErrors();
    expect(count).toBe(4);
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      "Stripe webhook errors in last 24h",
      expect.objectContaining({ level: "error", extra: { count: 4 } }),
    );
  });

  it("returns 0 and does not alert when there are no recent errors", async () => {
    mockCountWhere.mockResolvedValue([{ count: 0 }]);
    const count = await checkRecentWebhookErrors();
    expect(count).toBe(0);
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it("treats an empty result set as 0", async () => {
    mockCountWhere.mockResolvedValue([]);
    const count = await checkRecentWebhookErrors();
    expect(count).toBe(0);
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });
});
