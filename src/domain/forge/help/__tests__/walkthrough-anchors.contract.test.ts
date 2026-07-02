import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { WALKTHROUGHS } from "../catalog";

// Every anchorId a walkthrough references MUST exist as a data-forge-anchor in
// source — a renamed/removed anchor fails CI here, not a user's tour.
const anchorIds = [...new Set(WALKTHROUGHS.flatMap((w) => w.steps.map((s) => s.anchorId)))];

describe("walkthrough anchor contract", () => {
  it.each(anchorIds)('anchor "%s" is present in src/', (id) => {
    let hits = "";
    try {
      hits = execFileSync("grep", ["-rl", `data-forge-anchor="${id}"`, "src"], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
    } catch {
      hits = ""; // grep exits non-zero on no match
    }
    expect(hits.trim().length, `no data-forge-anchor="${id}" found in src/`).toBeGreaterThan(0);
  });
});
