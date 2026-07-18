import { describe, it, expect } from "vitest";
import { matchDependentsToFamily } from "../family-link-backfill";

describe("matchDependentsToFamily", () => {
  it("links exact case-insensitive name matches", () => {
    const out = matchDependentsToFamily(
      [{ id: "c1", firstName: "emma ", lastName: "DOE" }],
      [{ id: "f1", firstName: "Emma", lastName: "Doe", linked: false }],
    );
    expect(out.get("c1")).toBe("f1");
  });

  it("skips ambiguous names on either side", () => {
    const twoFams = matchDependentsToFamily(
      [{ id: "c1", firstName: "Emma", lastName: "Doe" }],
      [
        { id: "f1", firstName: "Emma", lastName: "Doe", linked: false },
        { id: "f2", firstName: "Emma", lastName: "Doe", linked: false },
      ],
    );
    expect(twoFams.size).toBe(0);
    const twoDeps = matchDependentsToFamily(
      [
        { id: "c1", firstName: "Emma", lastName: "Doe" },
        { id: "c2", firstName: "Emma", lastName: "Doe" },
      ],
      [{ id: "f1", firstName: "Emma", lastName: "Doe", linked: false }],
    );
    expect(twoDeps.size).toBe(0);
  });

  it("ignores already-linked members and null last names", () => {
    const out = matchDependentsToFamily(
      [{ id: "c1", firstName: "Emma", lastName: "Doe" }],
      [{ id: "f1", firstName: "Emma", lastName: "Doe", linked: true }],
    );
    expect(out.size).toBe(0);
    const nullLast = matchDependentsToFamily(
      [{ id: "c2", firstName: "Solo", lastName: "" }],
      [{ id: "f2", firstName: "Solo", lastName: null, linked: false }],
    );
    expect(nullLast.get("c2")).toBe("f2");
  });
});
