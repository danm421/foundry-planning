import { describe, it, expect } from "vitest";
import { accountCreateSchema } from "../accounts";

describe("accountCreateSchema — activation", () => {
  it("accepts activationYear + activationYearRef", () => {
    const parsed = accountCreateSchema.parse({
      name: "Inheritance",
      category: "taxable",
      activationYear: 2035,
      activationYearRef: "client_retirement",
    });
    expect(parsed.activationYear).toBe(2035);
    expect(parsed.activationYearRef).toBe("client_retirement");
  });

  it("defaults activation fields to null when omitted", () => {
    const parsed = accountCreateSchema.parse({
      name: "Cash",
      category: "cash",
    });
    expect(parsed.activationYear ?? null).toBeNull();
    expect(parsed.activationYearRef ?? null).toBeNull();
  });
});
