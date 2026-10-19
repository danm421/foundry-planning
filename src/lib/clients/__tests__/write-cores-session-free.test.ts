/**
 * Every write core checks client access through `verifyClientAccessAs`, so a
 * caller with a verified principal (the Claude connector, which has no Clerk
 * session) can run it. A core that calls `verifyClientAccess(` directly reads
 * the session whatever its caller passed, and refuses that caller. The
 * base-case lookup the create cores share (`base-case.ts`) is held to the same.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CLIENTS_DIR = join(process.cwd(), "src/lib/clients");

describe("the write cores' access checks", () => {
  it("no write core checks access through the session directly", () => {
    const cores = readdirSync(CLIENTS_DIR).filter((f) => f.endsWith("-writes.ts"));
    expect(cores.length).toBeGreaterThan(0);
    const offenders = [...cores, "base-case.ts"].filter((f) => /verifyClientAccess\(/.test(readFileSync(join(CLIENTS_DIR, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
