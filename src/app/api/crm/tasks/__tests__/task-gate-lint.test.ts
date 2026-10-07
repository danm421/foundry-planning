// The task mutations in `@/lib/crm-tasks/mutations` perform no auth, so each
// route gates itself. This scans the route files so a new or edited handler
// that skips the gate fails here, not in a review. Behavior is covered by
// task-route-gates.test.ts; this only proves no handler is left out.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";

const TASKS_DIR = path.resolve(__dirname, "..");

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) routeFiles(full, out);
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

// Each exported handler's source, keyed "<file> <METHOD>".
function handlers(file: string): [string, string][] {
  const src = readFileSync(file, "utf8");
  const rel = path.relative(TASKS_DIR, file);
  return src
    .split(/(?=export async function )/)
    .slice(1)
    .map((block) => [`${rel} ${block.match(/export async function (\w+)/)![1]}`, block]);
}

const perTask = routeFiles(path.join(TASKS_DIR, "[taskId]")).flatMap(handlers);
const all = routeFiles(TASKS_DIR).flatMap(handlers);

describe("CRM task route gates", () => {
  it("finds the task routes", () => {
    expect(perTask.length).toBeGreaterThanOrEqual(10);
  });

  it.each(perTask)("%s reads the task through the CRM task rule", (_name, block) => {
    // requireCrmTaskAccess, or a getTaskById read that takes the viewer.
    expect(block).toMatch(/requireCrmTaskAccess\(|getTaskById\([^)]*\{ userId, orgRole \}\)/);
  });

  it.each(all.filter(([, block]) => /\b(createTask|updateTaskField)\(/.test(block)))(
    "%s checks a household before putting a task on it",
    (_name, block) => {
      expect(block).toMatch(/requireCrmHouseholdAccess\(/);
    },
  );
});
