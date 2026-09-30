import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// SolverPage is an async server component (Clerk + DB), so rendering it in
// vitest isn't practical — this reads the source instead, per Ruling P2 in
// the solver-changes-tab task-2 brief. The Changes drawer moved in-pane (see
// solver-changes-tab.tsx / LEFT_TABS in live-solver-workspace.tsx), so the
// page must stop mounting the right-edge ScenarioDrawerShell — every other
// scenario-aware page still uses it. The full "does the tab actually work"
// behavior is covered by the browser pass in a later task.
describe("SolverPage — no longer mounts the Changes drawer shell", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/(app)/clients/[id]/solver/page.tsx"),
    "utf8",
  );

  it("does not import scenario-drawer-shell", () => {
    expect(source).not.toContain("scenario-drawer-shell");
  });

  it("does not reference ScenarioDrawerShell", () => {
    expect(source).not.toContain("ScenarioDrawerShell");
  });
});
