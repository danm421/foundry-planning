import { describe, it, expect } from "vitest";
import { runProjection } from "@/engine/projection";
import { buildClientData } from "@/engine/__tests__/fixtures";

// livingItems is entry and display only: the projection reads the row's
// annualAmount, which the write layer keeps equal to the items' total. Same
// two-part guard as payment-month-is-presentation-only.test.ts.
describe("livingItems is presentation only", () => {
  it("produces byte-identical projection output with or without items", () => {
    const base = buildClientData();
    expect(base.expenses.some((e) => e.type === "living")).toBe(true);

    const itemized = {
      ...base,
      expenses: base.expenses.map((e) =>
        e.type === "living"
          ? {
              ...e,
              // Deliberately NOT equal to annualAmount: if the engine summed
              // items, this would move every year of the projection.
              livingItems: [{ id: "x", name: "Boat", amount: 999999, frequency: "annual" as const }],
            }
          : e,
      ),
    };

    expect(JSON.stringify(runProjection(itemized))).toEqual(JSON.stringify(runProjection(base)));
  });

  it("no file under src/engine reads livingItems", async () => {
    const { execFileSync } = await import("node:child_process");
    // grep exits 1 with no matches, which is the passing case.
    const grep = (pattern: string) => {
      try {
        return execFileSync("/usr/bin/grep", ["-rl", pattern, "src/engine"], { encoding: "utf8" });
      } catch {
        return "";
      }
    };
    expect(grep("\\.livingItems").trim()).toBe("");
    const mentions = grep("livingItems")
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean)
      .sort();
    expect(mentions).toEqual(["src/engine/types.ts"]);
  });
});
