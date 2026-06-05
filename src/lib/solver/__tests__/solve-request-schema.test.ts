import { describe, expect, it } from "vitest";
import { SOLVE_REQUEST_SCHEMA } from "../solve-request-schema";

const base = { source: "base" as const, mutations: [] };

describe("SOLVE_REQUEST_SCHEMA", () => {
  it("accepts an ss-claim-age body without targetPoS", () => {
    const r = SOLVE_REQUEST_SCHEMA.safeParse({
      ...base,
      target: { kind: "ss-claim-age", person: "client" },
    });
    expect(r.success).toBe(true);
  });

  it("rejects a non-SS body without targetPoS", () => {
    const r = SOLVE_REQUEST_SCHEMA.safeParse({
      ...base,
      target: { kind: "retirement-age", person: "client" },
    });
    expect(r.success).toBe(false);
  });

  it("accepts a non-SS body with targetPoS", () => {
    const r = SOLVE_REQUEST_SCHEMA.safeParse({
      ...base,
      target: { kind: "retirement-age", person: "client" },
      targetPoS: 0.85,
    });
    expect(r.success).toBe(true);
  });
});
