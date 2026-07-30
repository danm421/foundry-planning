/**
 * `updateCrmHouseholdSchema` must be PARTIAL — absent keys must stay absent.
 *
 * This is the highest-blast-radius instance of the Zod 4 default-injection bug
 * (see `@/lib/schemas/strict-partial`). The PATCH route does not guard writes
 * at all — it hands `parsed.data` straight to `updateCrmHousehold`, which does
 * a wholesale `.set({ ...resolved, updatedAt })`. So an injected
 * `status: "prospect"` would silently demote a live client household back to a
 * prospect, AND `updateCrmHousehold` would record a phantom `status_change`
 * activity row narrating a change nobody made.
 *
 * Currently masked: both PATCH callers (`household-status-select.tsx`,
 * `crm-household-edit-form.tsx`) happen to send `status`. That is luck, not
 * design — a rename-only or notes-only inline edit is all it would take.
 */
import { describe, it, expect } from "vitest";
import { createCrmHouseholdSchema, updateCrmHouseholdSchema } from "../schemas";

describe("updateCrmHouseholdSchema is partial", () => {
  it("parses a one-key body to exactly that one key", () => {
    const result = updateCrmHouseholdSchema.safeParse({ name: "Cooper Family" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Object.keys(result.data)).toHaveLength(1);
    expect(result.data).toEqual({ name: "Cooper Family" });
  });

  it("does not inject `status` on a rename-only patch", () => {
    const result = updateCrmHouseholdSchema.safeParse({ name: "Renamed" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    // An injected "prospect" here demotes an active client and logs a fake
    // status_change activity — the route applies `parsed.data` unguarded.
    expect(result.data).not.toHaveProperty("status");
  });

  it("parses an empty body to an empty object", () => {
    const result = updateCrmHouseholdSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({});
  });

  it("still round-trips the values the caller actually sent", () => {
    const result = updateCrmHouseholdSchema.safeParse({
      status: "active",
      notes: "Reviewed 2026-07-30",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({ status: "active", notes: "Reviewed 2026-07-30" });
  });

  it("still rejects an invalid status", () => {
    expect(updateCrmHouseholdSchema.safeParse({ status: "lapsed" }).success).toBe(false);
  });

  it("still rejects an empty name", () => {
    expect(updateCrmHouseholdSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("still excludes create-only `contacts`", () => {
    const result = updateCrmHouseholdSchema.safeParse({
      name: "X",
      contacts: [{ role: "primary", firstName: "A", lastName: "B" }],
    });
    expect(result.success).toBe(true);
    // `contacts` is not a household column — it must never reach the .set().
    if (result.success) expect(result.data).not.toHaveProperty("contacts");
  });
});

describe("createCrmHouseholdSchema keeps its defaults", () => {
  it("still defaults status to prospect on create", () => {
    const result = createCrmHouseholdSchema.safeParse({
      name: "New Household",
      advisorId: "advisor_123",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("prospect");
  });
});
