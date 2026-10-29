import { describe, it, expect } from "vitest";
import { createEventSchema, createTodoSchema, moveEventSchema, updateTodoSchema } from "./schemas";

describe("workspace schemas", () => {
  it("createEvent applies defaults and trims the subject", () => {
    const r = createEventSchema.parse({ subject: "  Review ", start: "2026-11-02T09:00", end: "2026-11-02T10:00" });
    expect(r).toEqual({ subject: "Review", start: "2026-11-02T09:00", end: "2026-11-02T10:00", attendees: [], teams: false });
  });
  it("rejects end <= start, bad emails, and offset-bearing times", () => {
    const base = { subject: "x", start: "2026-11-02T09:00", end: "2026-11-02T10:00" };
    expect(createEventSchema.safeParse({ ...base, end: "2026-11-02T09:00" }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...base, attendees: ["nope"] }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...base, start: "2026-11-02T09:00:00Z" }).success).toBe(false);
    expect(moveEventSchema.safeParse({ start: "2026-11-02T10:00", end: "2026-11-02T09:00" }).success).toBe(false);
  });
  it("createTodo defaults dueDate and notes", () => {
    expect(createTodoSchema.parse({ title: "Call" })).toEqual({ title: "Call", dueDate: null, notes: "" });
    expect(createTodoSchema.safeParse({ title: "Call", dueDate: "2026-13-40" }).success).toBe(false);
  });
  it("updateTodo needs at least one field", () => {
    expect(updateTodoSchema.safeParse({}).success).toBe(false);
    expect(updateTodoSchema.parse({ completed: true })).toEqual({ completed: true });
  });
});
