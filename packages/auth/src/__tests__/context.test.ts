import { describe, it, expect } from "vitest";
import {
  runWithActingContext,
  getCurrentActingContext,
  type ActingContext,
} from "../context";

const sampleCtx: ActingContext = {
  actorAdminId: "admin-1",
  role: "support",
  impersonation: null,
};

describe("ActingContext AsyncLocalStorage", () => {
  it("returns undefined outside of runWithActingContext", () => {
    expect(getCurrentActingContext()).toBeUndefined();
  });

  it("provides the context inside the callback", async () => {
    const result = await runWithActingContext(sampleCtx, async () => {
      return getCurrentActingContext();
    });
    expect(result).toEqual(sampleCtx);
  });

  it("isolates concurrent contexts", async () => {
    const [a, b] = await Promise.all([
      runWithActingContext({ ...sampleCtx, actorAdminId: "a" }, async () =>
        getCurrentActingContext()?.actorAdminId,
      ),
      runWithActingContext({ ...sampleCtx, actorAdminId: "b" }, async () =>
        getCurrentActingContext()?.actorAdminId,
      ),
    ]);
    expect(a).toBe("a");
    expect(b).toBe("b");
  });
});
