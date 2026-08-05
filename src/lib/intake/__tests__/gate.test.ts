import { describe, it, expect, beforeAll } from "vitest";
import {
  matchesIntakeIdentity,
  signGateSession,
  verifyGateSession,
  gateCookieName,
  GATE_SESSION_MS,
} from "../gate";

// The gate key derives from INTAKE_GATE_SECRET (or CLERK_SECRET_KEY). Tests
// pin it so signatures are reproducible without touching real secrets.
beforeAll(() => {
  process.env.INTAKE_GATE_SECRET = "test-gate-secret-do-not-use-in-prod";
});

const form = (over: Partial<{ recipientName: string | null; recipientEmail: string }> = {}) => ({
  recipientName: "Cooper Sample" as string | null,
  recipientEmail: "danmueller20@gmail.com",
  ...over,
});

describe("matchesIntakeIdentity", () => {
  it("accepts the exact last name + email", () => {
    expect(
      matchesIntakeIdentity(form(), { lastName: "Sample", email: "danmueller20@gmail.com" }),
    ).toBe(true);
  });

  it("is case- and whitespace-insensitive on both fields", () => {
    expect(
      matchesIntakeIdentity(form(), {
        lastName: "  sAMPle ",
        email: "  DanMueller20@GMAIL.com  ",
      }),
    ).toBe(true);
  });

  it("rejects a wrong last name even with the right email", () => {
    expect(
      matchesIntakeIdentity(form(), { lastName: "Wrong", email: "danmueller20@gmail.com" }),
    ).toBe(false);
  });

  it("rejects a wrong email even with the right last name", () => {
    expect(
      matchesIntakeIdentity(form(), { lastName: "Sample", email: "attacker@evil.com" }),
    ).toBe(false);
  });

  it("rejects empty input", () => {
    expect(matchesIntakeIdentity(form(), { lastName: "", email: "" })).toBe(false);
    expect(
      matchesIntakeIdentity(form(), { lastName: "   ", email: "danmueller20@gmail.com" }),
    ).toBe(false);
  });

  // Real-world name shapes — a client must never be locked out of their own
  // form because of punctuation, accents, or a multi-word surname.
  it("ignores diacritics, punctuation and internal spacing in the surname", () => {
    expect(
      matchesIntakeIdentity(form({ recipientName: "Renée O'Brien-Smith" }), {
        lastName: "obrien smith",
        email: "danmueller20@gmail.com",
      }),
    ).toBe(true);
  });

  // Discriminating on tokenization, not just on punctuation folding: if the
  // combining-mark strip regressed, "Álvarez" would tokenize as ["a","lvarez"]
  // and the bare fragment "lvarez" would wrongly unlock the form.
  it("treats an accented surname as one token", () => {
    const f = form({ recipientName: "José Álvarez" });
    expect(matchesIntakeIdentity(f, { lastName: "Álvarez", email: f.recipientEmail })).toBe(true);
    expect(matchesIntakeIdentity(f, { lastName: "alvarez", email: f.recipientEmail })).toBe(true);
    expect(matchesIntakeIdentity(f, { lastName: "lvarez", email: f.recipientEmail })).toBe(false);
  });

  it("accepts a multi-token surname typed in full", () => {
    const f = form({ recipientName: "Mary Anne Van Der Berg" });
    // Last token alone
    expect(matchesIntakeIdentity(f, { lastName: "Berg", email: f.recipientEmail })).toBe(true);
    // The full surname as the client thinks of it
    expect(
      matchesIntakeIdentity(f, { lastName: "Van Der Berg", email: f.recipientEmail }),
    ).toBe(true);
  });

  it("accepts the full stored name typed into the surname box", () => {
    expect(
      matchesIntakeIdentity(form(), { lastName: "Cooper Sample", email: "danmueller20@gmail.com" }),
    ).toBe(true);
  });

  it("does not accept a bare first name as the surname", () => {
    expect(
      matchesIntakeIdentity(form(), { lastName: "Cooper", email: "danmueller20@gmail.com" }),
    ).toBe(false);
  });

  // Fallback: the advisor never supplied a name. recipient_name is nullable and
  // the create API accepts a missing name, so email alone must still let the
  // rightful recipient in rather than making the form unopenable.
  it("falls back to email-only when no usable surname is stored", () => {
    for (const name of [null, "", "   ", "Cher"]) {
      const f = form({ recipientName: name });
      expect(matchesIntakeIdentity(f, { lastName: "", email: f.recipientEmail })).toBe(true);
      expect(matchesIntakeIdentity(f, { lastName: "anything", email: f.recipientEmail })).toBe(true);
      expect(matchesIntakeIdentity(f, { lastName: "", email: "attacker@evil.com" })).toBe(false);
    }
  });
});

describe("gate session cookie", () => {
  const formId = "11111111-1111-1111-1111-111111111111";
  const otherId = "22222222-2222-2222-2222-222222222222";
  const now = new Date("2026-08-05T12:00:00Z");

  it("round-trips a freshly signed session", () => {
    const value = signGateSession(formId, now);
    expect(verifyGateSession(value, formId, now)).toBe(true);
  });

  it("namespaces the cookie per form", () => {
    expect(gateCookieName(formId)).not.toBe(gateCookieName(otherId));
    expect(gateCookieName(formId)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects a session minted for a different form", () => {
    const value = signGateSession(otherId, now);
    expect(verifyGateSession(value, formId, now)).toBe(false);
  });

  it("rejects a session past its expiry", () => {
    const value = signGateSession(formId, now);
    const justInside = new Date(now.getTime() + GATE_SESSION_MS - 1000);
    const justOutside = new Date(now.getTime() + GATE_SESSION_MS + 1000);
    expect(verifyGateSession(value, formId, justInside)).toBe(true);
    expect(verifyGateSession(value, formId, justOutside)).toBe(false);
  });

  it("rejects a tampered expiry (signature covers it)", () => {
    const value = signGateSession(formId, now);
    const [, sig] = value.split(".");
    const forgedExp = String(now.getTime() + 10 * GATE_SESSION_MS);
    expect(verifyGateSession(`${forgedExp}.${sig}`, formId, now)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const value = signGateSession(formId, now);
    const [exp] = value.split(".");
    expect(verifyGateSession(`${exp}.deadbeef`, formId, now)).toBe(false);
  });

  it("rejects malformed and empty values without throwing", () => {
    for (const bad of ["", "nonsense", "...", "abc.def.ghi", "notanumber.sig"]) {
      expect(verifyGateSession(bad, formId, now)).toBe(false);
    }
    expect(verifyGateSession(null, formId, now)).toBe(false);
    expect(verifyGateSession(undefined, formId, now)).toBe(false);
  });
});
