import { describe, it, expect } from "vitest";
import { z } from "zod";
import { formatZodIssues } from "../common";

describe("formatZodIssues", () => {
  it("strips received values, keeping only path + message", () => {
    const err = z.object({ age: z.number() }).safeParse({ age: "x" });
    expect(err.success).toBe(false);
    if (!err.success) {
      const out = formatZodIssues(err.error);
      expect(out).toEqual([{ path: "age", message: expect.any(String) }]);
      // Only path + message keys survive — the raw `received` value, `code`,
      // and `expected` fields zod attaches to each issue must not leak through.
      // (Zod's human message text may mention the received *type*, e.g.
      // "expected number, received string"; that's fine — what must not leak is
      // the attacker-supplied *value* or internal issue fields.)
      for (const issue of out) {
        expect(Object.keys(issue).sort()).toEqual(["message", "path"]);
      }
    }
  });
});
