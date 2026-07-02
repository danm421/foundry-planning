import { describe, it, expect } from "vitest";
import { deriveNoteSubject, todayLocalDate } from "../quick-note";

describe("deriveNoteSubject", () => {
  it("returns the first line of plain text", () => {
    expect(deriveNoteSubject("Called about RMDs\nSecond line")).toBe("Called about RMDs");
  });

  it("skips leading blank lines", () => {
    expect(deriveNoteSubject("\n  \nActual content")).toBe("Actual content");
  });

  it("strips heading, list, and blockquote markers", () => {
    expect(deriveNoteSubject("## Meeting recap")).toBe("Meeting recap");
    expect(deriveNoteSubject("- first bullet")).toBe("first bullet");
    expect(deriveNoteSubject("1. first item")).toBe("first item");
    expect(deriveNoteSubject("> quoted intro")).toBe("quoted intro");
  });

  it("strips inline emphasis, code, and link syntax", () => {
    expect(deriveNoteSubject("**Bold** and _em_ and `code`")).toBe("Bold and em and code");
    expect(deriveNoteSubject("[Roth ladder](https://x.test) discussion")).toBe(
      "Roth ladder discussion",
    );
  });

  it("truncates to 80 chars with an ellipsis", () => {
    const long = "a".repeat(100);
    const subject = deriveNoteSubject(long);
    expect(subject.length).toBeLessThanOrEqual(80);
    expect(subject.endsWith("…")).toBe(true);
  });

  it("falls back to 'Quick note' for empty or marker-only bodies", () => {
    expect(deriveNoteSubject("")).toBe("Quick note");
    expect(deriveNoteSubject("   \n\n  ")).toBe("Quick note");
    expect(deriveNoteSubject("**")).toBe("Quick note");
  });
});

describe("todayLocalDate", () => {
  it("returns a YYYY-MM-DD string", () => {
    expect(todayLocalDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
