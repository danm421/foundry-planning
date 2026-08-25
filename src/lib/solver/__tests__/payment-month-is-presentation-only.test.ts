import { describe, it, expect } from "vitest";
import { runProjection } from "@/engine/projection";
import { buildClientData } from "@/engine/__tests__/fixtures";

describe("paymentMonth is presentation only", () => {
  it("produces byte-identical projection output regardless of the month", () => {
    const base = buildClientData();
    expect(base.incomes.length).toBeGreaterThan(0);
    expect(base.expenses.length).toBeGreaterThan(0);

    const march = {
      ...base,
      incomes: base.incomes.map((i) => ({ ...i, paymentMonth: 3 })),
      expenses: base.expenses.map((e) => ({ ...e, paymentMonth: 11 })),
    };

    const a = JSON.stringify(runProjection(base));
    const b = JSON.stringify(runProjection(march));
    expect(b).toEqual(a);
  });

  // paymentMonth is a presentation-only field: the solver's month-by-month view
  // renders it, and engine math must never see it. A March bonus and a December
  // bonus have to produce the same projection. The test above proves that for
  // one fixture; these two greps prove it for every input, because no engine
  // file can act on a field it never mentions.
  it("no file under src/engine reads paymentMonth", async () => {
    const { execFileSync } = await import("node:child_process");
    // grep exits 1 with no matches, which is the passing case.
    const grep = (pattern: string) => {
      try {
        return execFileSync("/usr/bin/grep", ["-rl", pattern, "src/engine"], {
          encoding: "utf8",
        });
      } catch {
        return "";
      }
    };

    // 1. No property access. A type declaration (`paymentMonth?: number | null;`)
    //    has no leading dot, so the declaration site does not match this.
    expect(grep("\\.paymentMonth").trim()).toBe("");

    // 2. The only engine file allowed to mention the identifier at all is the
    //    declaration site. This closes the loophole where an engine file
    //    destructures the field instead of dotting it.
    const mentions = grep("paymentMonth")
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean)
      .sort();
    expect(mentions).toEqual(["src/engine/types.ts"]);
  });
});
