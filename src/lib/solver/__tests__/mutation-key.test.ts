import { describe, it, expect } from "vitest";
import { mutationKey } from "../types";

describe("mutationKey — technique upserts", () => {
  it("keys a roth-conversion-upsert by id", () => {
    expect(
      mutationKey({ kind: "roth-conversion-upsert", id: "rc-1", value: null }),
    ).toBe("roth-conversion-upsert:rc-1");
  });

  it("keys an asset-transaction-upsert by id", () => {
    expect(
      mutationKey({ kind: "asset-transaction-upsert", id: "at-1", value: null }),
    ).toBe("asset-transaction-upsert:at-1");
  });

  it("keys a reinvestment-upsert by id", () => {
    expect(
      mutationKey({ kind: "reinvestment-upsert", id: "ri-1", value: null }),
    ).toBe("reinvestment-upsert:ri-1");
  });
});
