// src/lib/imports/__tests__/drafts-list-row.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

import { draftsListRow, type ImportListRow } from "../list";

describe("draftsListRow", () => {
  it("keeps only what the imports list shows — never the payload (a fact finder, its transcript and change list)", () => {
    const updatedAt = new Date("2026-10-15T12:00:00Z");
    const row = {
      id: "i1", clientId: "c1", orgId: "org_1", status: "review", mode: "onboarding", notes: "June statements",
      payloadJson: { factFinder: { version: 9, transcript: [{ text: "SSN [REDACTED-SSN]" }] } },
      fileCount: 3, extractionCount: 2, factFinder: true, updatedAt, createdAt: updatedAt,
    } as unknown as ImportListRow;
    expect(draftsListRow(row)).toEqual({ id: "i1", status: "review", mode: "onboarding", notes: "June statements", fileCount: 3, updatedAt, factFinder: true });
  });
});
