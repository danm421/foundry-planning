import { describe, it, expect } from "vitest";
import { createCrmNoteSchema, updateCrmNoteSchema } from "../schemas";

describe("createCrmNoteSchema", () => {
  it("accepts a valid note and defaults body to ''", () => {
    const parsed = createCrmNoteSchema.parse({
      subject: "Annual review",
      noteKind: "meeting",
      noteDate: "2026-06-15",
    });
    expect(parsed).toEqual({
      subject: "Annual review",
      body: "",
      noteKind: "meeting",
      noteDate: "2026-06-15",
    });
  });

  it("defaults noteKind to 'note'", () => {
    const parsed = createCrmNoteSchema.parse({ subject: "Quick call", noteDate: "2026-06-15" });
    expect(parsed.noteKind).toBe("note");
  });

  it("trims and rejects an empty subject", () => {
    expect(() => createCrmNoteSchema.parse({ subject: "   ", noteDate: "2026-06-15" })).toThrow();
  });

  it("rejects a subject over 300 chars", () => {
    expect(() =>
      createCrmNoteSchema.parse({ subject: "x".repeat(301), noteDate: "2026-06-15" }),
    ).toThrow();
  });

  it("rejects a body over 20000 chars", () => {
    expect(() =>
      createCrmNoteSchema.parse({
        subject: "x",
        noteDate: "2026-06-15",
        body: "x".repeat(20_001),
      }),
    ).toThrow();
  });

  it("rejects a non-ISO date", () => {
    expect(() => createCrmNoteSchema.parse({ subject: "x", noteDate: "06/15/2026" })).toThrow();
  });

  it("rejects an unknown noteKind", () => {
    expect(() =>
      createCrmNoteSchema.parse({ subject: "x", noteKind: "fax", noteDate: "2026-06-15" }),
    ).toThrow();
  });
});

describe("updateCrmNoteSchema", () => {
  it("allows a partial update with only the provided fields", () => {
    expect(updateCrmNoteSchema.parse({ subject: "Edited" })).toEqual({ subject: "Edited" });
  });

  it("allows an empty object (no-op patch)", () => {
    expect(updateCrmNoteSchema.parse({})).toEqual({});
  });

  it("still validates provided fields", () => {
    expect(() => updateCrmNoteSchema.parse({ subject: "" })).toThrow();
  });
});
