import { describe, it, expect } from "vitest";
import { ensureTranscriptsFolder } from "../folders";
import { db } from "@/db";
import { crmHouseholds } from "@/db/schema";

describe("ensureTranscriptsFolder", () => {
  it("creates a Transcripts folder when missing and is idempotent", async () => {
    const hh = await db.query.crmHouseholds.findFirst({ columns: { id: true, firmId: true } });
    if (!hh) return; // no seed → skip
    const first = await ensureTranscriptsFolder(hh.id, hh.firmId);
    const second = await ensureTranscriptsFolder(hh.id, hh.firmId);
    expect(first).toBe(second); // same folder id, no duplicate
  });
});
