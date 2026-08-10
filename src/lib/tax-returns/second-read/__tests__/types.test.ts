import { describe, it, expect } from "vitest";
import { aiResponseSchema, secondReadSchema, MAX_SECOND_READ_ITEMS } from "../types";

describe("aiResponseSchema", () => {
  it("accepts an item with a string transcription attributed to a form and line", () => {
    const parsed = aiResponseSchema.safeParse({
      items: [{
        headline: "Form 8283 noncash gift may need a qualified appraisal",
        detail: "The return includes a Form 8283 reporting donated property. Gifts of property over $5,000 generally require a qualified appraisal attached to the return.",
        form: "Form 8283",
        line: "Section B",
        quotedValue: "$28,500",
      }],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data!.items[0].quotedValue).toBe("$28,500");
  });

  it("DROPS a numeric quotedValue rather than coercing it — a number is a computation surface", () => {
    const parsed = aiResponseSchema.safeParse({
      items: [{ headline: "h", detail: "d", form: "Schedule 1", line: "8z", quotedValue: 28500 }],
    });
    expect(parsed.success).toBe(false);
  });

  it("has no field the model could put an estimated impact or saving in", () => {
    const parsed = aiResponseSchema.safeParse({
      items: [{
        headline: "h", detail: "d", form: "Schedule 1", line: "8z", quotedValue: null,
        estimatedImpact: 4200, estimatedSaving: 4200,
      }],
    });
    // Not .strict(): unknown keys are STRIPPED, not rejected — a model that
    // volunteers an impact must lose it, not lose the whole item.
    expect(parsed.success).toBe(true);
    expect(parsed.data!.items[0]).not.toHaveProperty("estimatedImpact");
    expect(parsed.data!.items[0]).not.toHaveProperty("estimatedSaving");
  });

  it("defaults a missing citation and a missing items array rather than failing", () => {
    const parsed = aiResponseSchema.safeParse({});
    expect(parsed.success).toBe(true);
    expect(parsed.data!.items).toEqual([]);
  });

  it("rejects an item with no headline — an unlabelled card is unusable", () => {
    const parsed = aiResponseSchema.safeParse({ items: [{ headline: "", detail: "d" }] });
    expect(parsed.success).toBe(false);
  });
});

describe("secondReadSchema", () => {
  it("round-trips a persisted blob", () => {
    const blob = {
      generatedAt: "2026-08-10T12:00:00.000Z",
      warnings: ["One document could not be read."],
      items: [{
        id: "sr-1", headline: "h", detail: "d",
        form: "Form 8283", line: "Section B", quotedValue: "$28,500", dismissed: false,
      }],
    };
    expect(secondReadSchema.parse(blob)).toEqual(blob);
  });

  it("degrades a blob written by an older shape instead of blanking the panel", () => {
    const parsed = secondReadSchema.safeParse({
      generatedAt: "2026-08-10T12:00:00.000Z",
      items: [{ id: "sr-1", headline: "h", detail: "d" }],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data!.items[0].dismissed).toBe(false);
    expect(parsed.data!.warnings).toEqual([]);
  });
});

describe("MAX_SECOND_READ_ITEMS", () => {
  it("is a small number — the panel is a supplement, not a second report", () => {
    expect(MAX_SECOND_READ_ITEMS).toBe(6);
  });
});
