// The sentence an advisor reads when a sample is refused. It is the only thing
// standing between the harvest button and a failure with no visible cause: the
// first long chapter anyone presses it on comes back a 400.
import { describe, it, expect } from "vitest";
import { sampleRefusal } from "../refusal";
import { VOICE_TEXT_MAX, VOICE_TEXT_MIN } from "@/lib/schemas/story-voice";

const GENERIC = "Couldn't save that. Try again.";

/** What `parseBody` returns for a schema failure (`lib/schemas/common.ts`). */
function refused(path: string) {
  return { error: "Validation failed", issues: [{ path, message: "Too big: whatever" }] };
}

describe("sampleRefusal", () => {
  it("names the cause and the actual ceiling when the text is too long", () => {
    const text = "x".repeat(VOICE_TEXT_MAX + 500);
    const out = sampleRefusal(refused("text"), text, GENERIC);
    expect(out).toContain("2,500 characters");
    expect(out).toContain("at most 2,000");
    expect(out).not.toBe(GENERIC);
  });

  // The same schema carries a floor, and the harvest button reaches it too — a
  // chapter cut down to a line. Told it was too LONG, an advisor would go and
  // shorten something already too short.
  it("says too short, not too long, when the text is under the floor", () => {
    const out = sampleRefusal(refused("text"), "too short", GENERIC);
    expect(out).toContain("at least 20");
    expect(out).not.toContain("at most");
  });

  it("reports the length that was actually submitted, not the limit", () => {
    const out = sampleRefusal(refused("text"), "x".repeat(VOICE_TEXT_MAX + 1), GENERIC);
    expect(out).toContain(`${(VOICE_TEXT_MAX + 1).toLocaleString("en-US")} characters`);
  });

  // The direction is read off the submitted text, but WHICH FIELD is read off
  // the issues — a 400 about the chapter id is not a sentence about length.
  it("falls through to the generic message when the refusal was about another field", () => {
    const text = "x".repeat(VOICE_TEXT_MAX + 500);
    expect(sampleRefusal(refused("sourceChapterId"), text, GENERIC)).toBe(GENERIC);
  });

  // A 403, a 500, a dropped connection: no issue list at all. The panel must not
  // explain those as a length problem.
  it.each([
    ["no body", null],
    ["an error with no issues", { error: "Internal server error" }],
    ["a non-object", "Forbidden"],
    ["issues that are not a list", { issues: "text" }],
  ])("falls through to the generic message given %s", (_label, body) => {
    expect(sampleRefusal(body, "x".repeat(VOICE_TEXT_MAX + 500), GENERIC)).toBe(GENERIC);
  });

  // The boundary the schema actually draws — `.min`/`.max` are inclusive, so a
  // string of exactly the limit is accepted and can only have been refused for
  // some other reason.
  it("does not describe a text of exactly the limit as out of bounds", () => {
    expect(sampleRefusal(refused("text"), "x".repeat(VOICE_TEXT_MAX), GENERIC)).toBe(GENERIC);
    expect(sampleRefusal(refused("text"), "x".repeat(VOICE_TEXT_MIN), GENERIC)).toBe(GENERIC);
  });
});
