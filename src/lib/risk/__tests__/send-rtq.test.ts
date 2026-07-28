import { describe, it, expect } from "vitest";
import { buildQuestionnaireRow } from "@/lib/risk/send-rtq";

const NOW = new Date("2026-07-28T00:00:00Z");

describe("buildQuestionnaireRow", () => {
  it("creates a tokened row in sent status with a 30-day expiry", () => {
    const row = buildQuestionnaireRow({
      clientId: "c1",
      firmId: "f1",
      createdByUserId: "u1",
      subject: "primary",
      recipientEmail: "client@example.com",
      recipientName: "Dana Cooper",
      now: NOW,
    });
    expect(row.status).toBe("sent");
    expect(row.token).toBeTruthy();
    expect(row.token!.length).toBeGreaterThan(20);
    expect(row.sentAt).toEqual(NOW);
    expect(row.expiresAt!.getTime()).toBe(NOW.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(row.score).toBeNull();
  });

  it("issues a distinct token per send", () => {
    const a = buildQuestionnaireRow({ clientId: "c1", firmId: "f1", createdByUserId: "u1", subject: "primary", recipientEmail: "a@b.c", now: NOW });
    const b = buildQuestionnaireRow({ clientId: "c1", firmId: "f1", createdByUserId: "u1", subject: "spouse", recipientEmail: "a@b.c", now: NOW });
    expect(a.token).not.toBe(b.token);
  });
});
