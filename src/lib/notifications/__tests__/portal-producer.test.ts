import { describe, it, expect, vi, beforeEach } from "vitest";

const { enqueueMock } = vi.hoisted(() => ({ enqueueMock: vi.fn() }));
vi.mock("@/lib/notifications/enqueue", () => ({ enqueueNotifications: enqueueMock }));

import { notifyPortalDisconnected } from "@/lib/notifications/producers/portal";
import {
  DEFAULT_NOTIFICATION_PREFS,
  EMAIL_ON_BY_DEFAULT,
  CATEGORY_LABELS,
} from "@/lib/notifications/catalog";

beforeEach(() => enqueueMock.mockClear());

describe("notifyPortalDisconnected", () => {
  it("notifies the owning advisor with a null actor", async () => {
    await notifyPortalDisconnected({
      firmId: "org_1",
      advisorId: "user_advisor",
      clientId: "client-1",
      clientName: "Dana Reed",
    });
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const arg = enqueueMock.mock.calls[0][0];
    expect(arg.recipients).toEqual(["user_advisor"]);
    // The CLIENT did this. A non-null actor would filter the advisor out if
    // the ids ever coincided.
    expect(arg.actorUserId).toBeNull();
    expect(arg.category).toBe("portal_disconnected");
    expect(arg.title).toBe("Dana Reed disconnected their portal access");
  });

  it("falls back when the household has no name on file", async () => {
    await notifyPortalDisconnected({
      firmId: "org_1",
      advisorId: "user_advisor",
      clientId: "client-1",
      clientName: null,
    });
    expect(enqueueMock.mock.calls[0][0].title).toBe("A client disconnected their portal access");
  });
});

describe("portal_disconnected catalog registration", () => {
  it("ships with email OFF, like every new category", () => {
    expect(DEFAULT_NOTIFICATION_PREFS.portal_disconnected).toEqual({ inApp: true, email: false });
    expect(EMAIL_ON_BY_DEFAULT).not.toContain("portal_disconnected");
  });

  it("has a label", () => {
    expect(CATEGORY_LABELS.portal_disconnected).toBe("Client disconnected their portal access");
  });
});
