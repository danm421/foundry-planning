import { describe, it, expect } from "vitest";
import { countWords } from "../meeting-transcripts";

describe("countWords", () => {
  it("counts whitespace-separated tokens", () => {
    expect(countWords("hello   world\nfoo\tbar")).toBe(4);
  });
  it("returns 0 for empty/whitespace", () => {
    expect(countWords("   \n  ")).toBe(0);
    expect(countWords("")).toBe(0);
  });
});

import { createMeetingTranscript, getOwnedMeetingTranscript, deleteMeetingTranscript } from "../meeting-transcripts";
import { db } from "@/db";

// Requires a seeded client+household; uses the dev branch. Skips cleanly if none.
describe("meeting-transcripts DB round-trip", () => {
  it("creates, reads back scoped, and deletes", async () => {
    const client = await db.query.clients.findFirst({
      columns: { id: true, firmId: true, crmHouseholdId: true },
    });
    if (!client?.crmHouseholdId) return; // no seed data → skip
    const { id, wordCount } = await createMeetingTranscript({
      clientId: client.id,
      householdId: client.crmHouseholdId,
      firmId: client.firmId,
      rawText: "Advisor: hello. Client: hi there.",
      source: "explicit",
    });
    expect(wordCount).toBeGreaterThan(0);
    const owned = await getOwnedMeetingTranscript(id, client.id, client.firmId);
    expect(owned?.id).toBe(id);
    // Wrong firm → not found (IDOR).
    const denied = await getOwnedMeetingTranscript(id, client.id, "firm_other");
    expect(denied).toBeNull();
    await deleteMeetingTranscript(id, client.id, client.firmId);
    const gone = await getOwnedMeetingTranscript(id, client.id, client.firmId);
    expect(gone).toBeNull();
  });
});
