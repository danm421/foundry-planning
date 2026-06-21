import { describe, it, expect } from "vitest";
import { isFirmPurgeable } from "../purge-eligibility";

const NOW = new Date("2026-06-21T00:00:00Z");
const PAST = new Date("2026-03-01T00:00:00Z");
const FUTURE = new Date("2026-12-01T00:00:00Z");

describe("isFirmPurgeable", () => {
  it("true: archived, retention elapsed, not purged, no live sub", () => {
    expect(
      isFirmPurgeable(
        { archivedAt: PAST, purgedAt: null, dataRetentionUntil: PAST, liveSubCount: 0 },
        NOW,
      ),
    ).toBe(true);
  });

  it("false: a live subscription exists (resubscribed firm)", () => {
    expect(
      isFirmPurgeable(
        { archivedAt: PAST, purgedAt: null, dataRetentionUntil: PAST, liveSubCount: 1 },
        NOW,
      ),
    ).toBe(false);
  });

  it("false: not archived", () => {
    expect(
      isFirmPurgeable(
        { archivedAt: null, purgedAt: null, dataRetentionUntil: PAST, liveSubCount: 0 },
        NOW,
      ),
    ).toBe(false);
  });

  it("false: already purged", () => {
    expect(
      isFirmPurgeable(
        { archivedAt: PAST, purgedAt: PAST, dataRetentionUntil: PAST, liveSubCount: 0 },
        NOW,
      ),
    ).toBe(false);
  });

  it("false: retention window not yet elapsed", () => {
    expect(
      isFirmPurgeable(
        { archivedAt: PAST, purgedAt: null, dataRetentionUntil: FUTURE, liveSubCount: 0 },
        NOW,
      ),
    ).toBe(false);
  });

  it("false: dataRetentionUntil is null (never set)", () => {
    expect(
      isFirmPurgeable(
        { archivedAt: PAST, purgedAt: null, dataRetentionUntil: null, liveSubCount: 0 },
        NOW,
      ),
    ).toBe(false);
  });
});
