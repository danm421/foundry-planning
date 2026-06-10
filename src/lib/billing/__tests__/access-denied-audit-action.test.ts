import { describe, it, expectTypeOf } from "vitest";
import type { AuditAction } from "@/lib/audit";

describe("billing.access_denied audit action", () => {
  it("is a member of the AuditAction union", () => {
    expectTypeOf<"billing.access_denied">().toMatchTypeOf<AuditAction>();
  });
});
