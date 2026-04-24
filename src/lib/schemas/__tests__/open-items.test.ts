import { describe, it, expect } from "vitest";
import { openItemCreateSchema, openItemUpdateSchema } from "@/lib/schemas/open-items";

describe("openItemCreateSchema", () => {
  it("accepts a minimal body", () => {
    const r = openItemCreateSchema.safeParse({ title: "Collect life-insurance docs" });
    expect(r.success).toBe(true);
  });

  it("defaults priority to 'medium' when omitted", () => {
    const r = openItemCreateSchema.parse({ title: "x" });
    expect(r.priority).toBe("medium");
  });

  it("accepts priority + dueDate", () => {
    const r = openItemCreateSchema.safeParse({
      title: "x",
      priority: "high",
      dueDate: "2026-06-01",
    });
    expect(r.success).toBe(true);
  });

  it("rejects empty title", () => {
    expect(openItemCreateSchema.safeParse({ title: "" }).success).toBe(false);
  });

  it("rejects invalid priority", () => {
    expect(
      openItemCreateSchema.safeParse({ title: "x", priority: "urgent" }).success,
    ).toBe(false);
  });

  it("rejects malformed dueDate", () => {
    expect(
      openItemCreateSchema.safeParse({ title: "x", dueDate: "not-a-date" }).success,
    ).toBe(false);
  });

  it("rejects unknown fields (strict)", () => {
    expect(
      openItemCreateSchema.safeParse({ title: "x", foo: "bar" }).success,
    ).toBe(false);
  });
});

describe("openItemUpdateSchema", () => {
  it("accepts a toggle-complete patch", () => {
    expect(
      openItemUpdateSchema.safeParse({ completedAt: "2026-04-24T12:00:00Z" }).success,
    ).toBe(true);
  });

  it("accepts clearing completedAt (null)", () => {
    expect(openItemUpdateSchema.safeParse({ completedAt: null }).success).toBe(true);
  });

  it("accepts empty patch (no-op)", () => {
    expect(openItemUpdateSchema.safeParse({}).success).toBe(true);
  });

  it("rejects unknown fields", () => {
    expect(
      openItemUpdateSchema.safeParse({ clientId: "sneak-through" }).success,
    ).toBe(false);
  });
});
