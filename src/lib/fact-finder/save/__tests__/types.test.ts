// src/lib/fact-finder/save/__tests__/types.test.ts
//
// The save writer contract's runtime pieces: a core's refusal becomes the
// line's SaveLineError, a core's error result can carry its route's own
// response body, and an Update line without its record is refused in the
// writer's own words.
import { describe, expect, it } from "vitest";
import { writeError } from "@/lib/clients/entity-write-result";
import { coreArgs, recordIdOf, SaveLineError, unwrap, type SaveContext, type SaveInput } from "../types";

describe("coreArgs", () => {
  const ctx = { clientId: "c1", firmId: "org_1", actorId: "user_ops", tx: {}, afterCommit: () => {}, holdings: new Map() } as unknown as SaveContext;

  it("passes the save's client, actor, transaction and queue", () => {
    expect(coreArgs(ctx)).toEqual({ clientId: "c1", firmId: "org_1", actorId: "user_ops", tx: ctx.tx, afterCommit: ctx.afterCommit });
  });

  it("passes the principal a save with no session runs on", () => {
    const principal = { userId: "user_1", orgId: "org_1", orgRole: "org:admin" };
    expect(coreArgs({ ...ctx, principal })).toMatchObject({ actorId: "user_ops", principal });
  });

  it("stamps the impersonated advisor on every core's audit row while an ops operator saves", () => {
    expect(coreArgs({ ...ctx, actingAsAdvisor: "user_1" })).toMatchObject({ actorId: "user_ops", crossFirmMeta: { actingAsAdvisor: "user_1" } });
  });
});

describe("unwrap", () => {
  it("hands back a core's data and resource id", () => {
    expect(unwrap({ ok: true, data: { id: "acct-1", name: "Schwab Brokerage" }, resourceId: "acct-1" })).toEqual({
      data: { id: "acct-1", name: "Schwab Brokerage" },
      resourceId: "acct-1",
    });
  });

  it("turns a core's refusal into a SaveLineError carrying the core's message", () => {
    let thrown: unknown;
    try {
      unwrap(writeError(404, "Grant not found"));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(SaveLineError);
    expect((thrown as SaveLineError).name).toBe("SaveLineError");
    expect((thrown as SaveLineError).message).toBe("Grant not found");
  });

  it("says a refusal that names an id or a column in plain words", () => {
    const id = "6f1c2a4e-1b2c-4d5e-8f90-123456789abc";
    expect(() => unwrap(writeError(400, `Account ${id} not owned by this client`))).toThrow(
      new SaveLineError("An account this line names isn't on the plan — review again."),
    );
    expect(() => unwrap(writeError(400, `External beneficiary ${id} not owned by this client`))).toThrow(
      "A charity or beneficiary this line names isn't on the plan — review again.",
    );
    expect(() => unwrap(writeError(409, "A will already exists for grantor='spouse'"))).toThrow(
      new SaveLineError("The plan already has this person's will — review again."),
    );
    expect(() => unwrap(writeError(400, `Account ${id} is not a business account`))).toThrow(
      "The business this line names isn't a business account on the plan — review again.",
    );
    expect(() => unwrap(writeError(400, `Model portfolio ${id} not available to this firm`))).toThrow(
      "A record this line names doesn't match the plan any more — review again.",
    );
  });

  it("names the route body's first issue, with its path, instead of the bare error", () => {
    const issues = (first: Record<string, unknown>) =>
      writeError(400, "Invalid body", { error: "Invalid body", issues: [first, { path: "name", message: "Required" }] });
    expect(() => unwrap(issues({ path: "benefitAmount", message: "Must be more than 0" }))).toThrow(
      new SaveLineError("benefitAmount: Must be more than 0"),
    );
    expect(() => unwrap(issues({ path: ["owners", 0, "percent"], message: "Too large" }))).toThrow("owners.0.percent: Too large");
    expect(() => unwrap(issues({ path: "", message: "Pick a life policy" }))).toThrow(new SaveLineError("Pick a life policy"));
  });

  it("keeps the core's error when the body has no issues", () => {
    expect(() => unwrap(writeError(400, "duplicate_liability_bequest", { error: "duplicate_liability_bequest", detail: "x" }))).toThrow(
      new SaveLineError("duplicate_liability_bequest"),
    );
  });
});

describe("writeError", () => {
  it("carries a route's own response body when it has one", () => {
    expect(writeError(400, "Invalid body", { error: "Invalid body", issues: [{ path: "name", message: "Required" }] })).toStrictEqual({
      ok: false,
      status: 400,
      error: "Invalid body",
      body: { error: "Invalid body", issues: [{ path: "name", message: "Required" }] },
    });
  });

  it("has no body key without one, exactly as before", () => {
    expect(writeError(404, "Client not found")).toStrictEqual({ ok: false, status: 404, error: "Client not found" });
  });
});

describe("recordIdOf", () => {
  const input = (recordId: string | null) => ({ recordId }) as SaveInput;

  it("hands back an Update line's record", () => {
    expect(recordIdOf(input("acct-1"), "The loan to change isn't on the plan.")).toBe("acct-1");
  });

  it("refuses a line with no record, in the writer's own words", () => {
    expect(() => recordIdOf(input(null), "The loan to change isn't on the plan.")).toThrow(new SaveLineError("The loan to change isn't on the plan."));
  });
});
