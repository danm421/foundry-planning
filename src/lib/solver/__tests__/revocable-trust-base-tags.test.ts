import { describe, it, expect } from "vitest";
import { revocableTrustTagChanges } from "../revocable-trust-base-tags";
import type { Account } from "@/engine/types";

const acct = (id: string, revocableTrustName?: string | null) =>
  ({ id, revocableTrustName }) as unknown as Account;

describe("revocableTrustTagChanges", () => {
  it("maps an account tagged on update to the trust name", () => {
    const m = revocableTrustTagChanges([acct("a")], [], [acct("a", "Rivera Trust")]);
    expect(m.get("a")).toBe("Rivera Trust");
  });

  it("maps a cleared tag to null", () => {
    const m = revocableTrustTagChanges([acct("a", "Rivera Trust")], [], [acct("a", null)]);
    expect(m.has("a")).toBe(true);
    expect(m.get("a")).toBeNull();
  });

  it("omits an unchanged tag", () => {
    const m = revocableTrustTagChanges([acct("a", "Rivera Trust")], [], [acct("a", "Rivera Trust")]);
    expect(m.has("a")).toBe(false);
  });

  it("includes an insert with a name and omits one without", () => {
    const m = revocableTrustTagChanges([], [acct("n1", "Rivera Trust"), acct("n2")], []);
    expect(m.get("n1")).toBe("Rivera Trust");
    expect(m.has("n2")).toBe(false);
  });

  it("reads a blank name as null", () => {
    const cleared = revocableTrustTagChanges([acct("a", "Rivera Trust")], [], [acct("a", "  ")]);
    expect(cleared.get("a")).toBeNull();
    const untouched = revocableTrustTagChanges([acct("a")], [], [acct("a", "  ")]);
    expect(untouched.has("a")).toBe(false);
  });
});
