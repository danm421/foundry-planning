import { describe, it, expect } from "vitest";
import { buildFieldChanges } from "../build-changes";
import type { FieldLabels } from "../types";

const LABELS: FieldLabels = {
  email: { label: "Email", format: "text" },
  balance: { label: "Balance", format: "currency" },
  ssnLast4: { label: "SSN last 4", format: "text", sensitive: true },
  notes: { label: "Notes", format: "text", truncate: 10 },
};

describe("buildFieldChanges", () => {
  it("emits a change only for fields whose value actually differs", () => {
    const changes = buildFieldChanges(
      { email: "a@x.com", balance: 100 },
      { email: "b@x.com", balance: 100 },
      LABELS,
    );
    expect(changes).toEqual([
      { field: "email", label: "Email", from: "a@x.com", to: "b@x.com", format: "text" },
    ]);
  });

  it("redacts sensitive fields — records the change, never the values", () => {
    const changes = buildFieldChanges(
      { ssnLast4: "4471" },
      { ssnLast4: "8823" },
      LABELS,
    );
    expect(changes).toEqual([
      {
        field: "ssnLast4",
        label: "SSN last 4",
        from: null,
        to: null,
        format: "text",
        redacted: true,
      },
    ]);
    expect(JSON.stringify(changes)).not.toContain("4471");
    expect(JSON.stringify(changes)).not.toContain("8823");
  });

  it("truncates free text past the descriptor limit", () => {
    const changes = buildFieldChanges(
      { notes: "short" },
      { notes: "a much longer note that exceeds the limit" },
      LABELS,
    );
    expect(changes[0]).toMatchObject({
      field: "notes",
      from: "short",
      to: "a much lon…",
    });
  });

  it("leaves values under the limit unclipped", () => {
    const changes = buildFieldChanges({ notes: "a" }, { notes: "b" }, LABELS);
    expect(changes[0]).toMatchObject({ field: "notes", from: "a", to: "b" });
  });

  it("treats added and removed keys as changes against null", () => {
    const changes = buildFieldChanges({ email: "a@x.com" }, {}, LABELS);
    expect(changes).toEqual([
      { field: "email", label: "Email", from: "a@x.com", to: null, format: "text" },
    ]);
  });

  it("falls back to a humanized label and text format for unlabelled fields", () => {
    const changes = buildFieldChanges({ preferredName: "Mike" }, { preferredName: "Mick" }, LABELS);
    // Matches the real (pre-existing, unmodified) humanizeFieldName output —
    // it only uppercases the leading character, so a camelCase word that was
    // already capitalized ("Name") stays capitalized.
    expect(changes[0]).toMatchObject({ label: "Preferred Name", format: "text" });
  });

  it("returns an empty array when nothing changed", () => {
    expect(buildFieldChanges({ email: "a@x.com" }, { email: "a@x.com" }, LABELS)).toEqual([]);
  });
});
