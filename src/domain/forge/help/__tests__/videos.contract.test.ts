// src/domain/forge/help/__tests__/videos.contract.test.ts
//
// Every details file in videos/ must parse, name itself, point at real app
// screens, and be imported by videos/index.ts (no orphan files). Loops inside
// single tests rather than it.each so an empty folder is a pass, not an error.
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { helpVideoSchema } from "../video-schema";
import { HELP_VIDEOS } from "../videos";

const DIR = path.resolve(__dirname, "../videos");
const APP = path.resolve(__dirname, "../../../../app/(app)");
const files = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();

/** "/clients/:id/cashflow" → src/app/(app)/clients/[id]/cashflow/page.tsx */
function pageFor(route: string): string {
  const segs = route.split("/").filter(Boolean).map((s) => (s.startsWith(":") ? `[${s.slice(1)}]` : s));
  return path.join(APP, ...segs, "page.tsx");
}

describe("Knowledge Hub details files", () => {
  it("videos/index.ts imports exactly the JSON files in the folder", () => {
    expect(HELP_VIDEOS.map((v) => `${v.slug}.json`).sort()).toEqual(files);
  });

  it("every file passes the schema and its slug is its file name", () => {
    for (const file of files) {
      const raw = JSON.parse(readFileSync(path.join(DIR, file), "utf8"));
      const parsed = helpVideoSchema.safeParse(raw);
      expect(parsed.success, `${file}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
      expect(raw.slug, file).toBe(file.replace(/\.json$/, ""));
    }
  });

  it("every screen route is a real page under src/app/(app)", () => {
    for (const v of HELP_VIDEOS) {
      for (const s of v.screens) expect(existsSync(pageFor(s.route)), `${v.slug}: ${s.route}`).toBe(true);
    }
  });

  it("pageFor maps a known route onto a real page (guards the mapping itself)", () => {
    expect(existsSync(pageFor("/clients/:id/details/income-expenses"))).toBe(true);
    expect(existsSync(pageFor("/clients/:id/solver"))).toBe(true);
  });
});
