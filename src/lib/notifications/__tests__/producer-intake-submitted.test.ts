import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted above this file's consts, and the factory dereferences the
// spy immediately — so it must be declared via vi.hoisted() (repo-standard
// pattern) or the mock throws "Cannot access 'enqueue' before initialization".
const enqueue = vi.hoisted(() => vi.fn());
vi.mock("@/lib/notifications/enqueue", () => ({ enqueueNotifications: enqueue }));

import { notifyIntakeSubmitted } from "../producers/intake";

beforeEach(() => enqueue.mockReset());

describe("notifyIntakeSubmitted", () => {
  it("routes to the owning advisor with a deep link to the form", async () => {
    await notifyIntakeSubmitted({
      firmId: "org_1",
      advisorId: "advisor_1",
      clientId: "client-1",
      formId: "form-1",
      recipientName: "The Johnsons",
    });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        firmId: "org_1",
        recipients: ["advisor_1"],
        category: "intake_submitted",
        clientId: "client-1",
        url: "/data-collection/form-1",
        entityType: "intake_form",
        entityId: "form-1",
      }),
    );
  });

  it("names the client in the title", async () => {
    await notifyIntakeSubmitted({
      firmId: "org_1",
      advisorId: "advisor_1",
      clientId: "client-1",
      formId: "form-1",
      recipientName: "The Johnsons",
    });
    expect(enqueue.mock.calls[0][0].title).toContain("The Johnsons");
  });

  it("falls back to a generic title when the form carries no name", async () => {
    await notifyIntakeSubmitted({
      firmId: "org_1",
      advisorId: "advisor_1",
      clientId: null,
      formId: "form-1",
      recipientName: null,
    });
    expect(enqueue.mock.calls[0][0].title).toBe("A client submitted their intake form");
  });

  // The client submitted it, not an advisor — so nobody is excluded as "actor".
  it("sends a null actor so the advisor is never filtered out", async () => {
    await notifyIntakeSubmitted({
      firmId: "org_1",
      advisorId: "advisor_1",
      clientId: "client-1",
      formId: "form-1",
      recipientName: "The Johnsons",
    });
    expect(enqueue.mock.calls[0][0].actorUserId).toBeNull();
  });
});
