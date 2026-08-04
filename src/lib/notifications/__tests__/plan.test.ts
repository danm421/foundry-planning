import { describe, it, expect } from "vitest";
import { planNotificationRows } from "../plan";
import { mergePrefs } from "../prefs";

const base = {
  firmId: "org_1",
  category: "intake_submitted" as const,
  actorUserId: null,
  clientId: "client-1",
  title: "The Johnsons submitted their intake form",
  body: null,
  url: "/data-collection/form-1",
  entityType: "intake_form",
  entityId: "form-1",
  dedupKey: null,
};

const on = mergePrefs({ intake_submitted: { inApp: true, email: true } });
const inAppOnly = mergePrefs({});
const muted = mergePrefs({ intake_submitted: { inApp: false, email: false } });

describe("planNotificationRows", () => {
  it("produces one row per recipient, stamped from that recipient's prefs", () => {
    const rows = planNotificationRows({
      ...base,
      recipients: [
        { userId: "u1", prefs: on },
        { userId: "u2", prefs: inAppOnly },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ userId: "u1", inApp: true, emailPending: true });
    expect(rows[1]).toMatchObject({ userId: "u2", inApp: true, emailPending: false });
  });

  it("carries every denormalized field through unchanged", () => {
    const [row] = planNotificationRows({
      ...base,
      recipients: [{ userId: "u1", prefs: on }],
    });
    expect(row).toEqual({
      firmId: "org_1",
      userId: "u1",
      category: "intake_submitted",
      actorUserId: null,
      clientId: "client-1",
      title: "The Johnsons submitted their intake form",
      body: null,
      url: "/data-collection/form-1",
      entityType: "intake_form",
      entityId: "form-1",
      dedupKey: null,
      inApp: true,
      emailPending: true,
    });
  });

  it("drops a recipient who muted both channels", () => {
    const rows = planNotificationRows({
      ...base,
      recipients: [
        { userId: "u1", prefs: muted },
        { userId: "u2", prefs: on },
      ],
    });
    expect(rows.map((r) => r.userId)).toEqual(["u2"]);
  });

  it("never notifies the actor about their own action", () => {
    const rows = planNotificationRows({
      ...base,
      actorUserId: "u1",
      recipients: [
        { userId: "u1", prefs: on },
        { userId: "u2", prefs: on },
      ],
    });
    expect(rows.map((r) => r.userId)).toEqual(["u2"]);
  });

  it("dedupes a repeated recipient", () => {
    const rows = planNotificationRows({
      ...base,
      recipients: [
        { userId: "u1", prefs: on },
        { userId: "u1", prefs: on },
      ],
    });
    expect(rows).toHaveLength(1);
  });

  it("returns [] rather than throwing when nobody is left", () => {
    expect(planNotificationRows({ ...base, recipients: [] })).toEqual([]);
  });
});
