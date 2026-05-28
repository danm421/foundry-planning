import { describe, it, expectTypeOf } from "vitest";
import type { AuditAction } from "../audit";

describe("AuditAction", () => {
  it("includes the three presentation_template actions", () => {
    expectTypeOf<"presentation_template.create">().toMatchTypeOf<AuditAction>();
    expectTypeOf<"presentation_template.update">().toMatchTypeOf<AuditAction>();
    expectTypeOf<"presentation_template.delete">().toMatchTypeOf<AuditAction>();
  });
});
