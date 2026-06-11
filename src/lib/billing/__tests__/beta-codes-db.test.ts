import { describe, it, expect, afterEach } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { betaCodes } from "@/db/schema";
import { mintCodes, validateCode, claimCode, hashCode, revokeCode } from "../beta-codes";

const hashes: string[] = [];
function track(codes: string[]) {
  for (const c of codes) hashes.push(hashCode(c));
}

afterEach(async () => {
  if (hashes.length) await db.delete(betaCodes).where(inArray(betaCodes.codeHash, hashes));
  hashes.length = 0;
});

describe("mintCodes", () => {
  it("returns N plaintext codes and inserts N hashed rows with the given entitlements", async () => {
    const codes = await mintCodes({ count: 3, entitlements: ["ai_import"], label: "batch-a" });
    track(codes);
    expect(codes).toHaveLength(3);
    const rows = await db.select().from(betaCodes).where(inArray(betaCodes.codeHash, codes.map(hashCode)));
    expect(rows).toHaveLength(3);
    expect(rows[0].entitlements).toEqual(["ai_import"]);
    expect(rows[0].label).toBe("batch-a");
  });
});

describe("validateCode", () => {
  it("reports valid for a fresh code and not_found for an unknown one", async () => {
    const [code] = await mintCodes({ count: 1 });
    track([code]);
    expect(await validateCode(code)).toEqual({ valid: true, entitlements: ["ai_import"] });
    expect(await validateCode("FNDR-0000-0000")).toEqual({ valid: false, reason: "not_found" });
  });
});

describe("claimCode (atomic single-use)", () => {
  it("first claim wins, second returns already_used", async () => {
    const [code] = await mintCodes({ count: 1 });
    track([code]);
    const first = await claimCode(code, "user_aaa");
    const second = await claimCode(code, "user_bbb");
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: "already_used" });
  });
});

describe("revokeCode", () => {
  it("sets revoked_at and is a no-op on a second call", async () => {
    const [code] = await mintCodes({ count: 1 });
    track([code]);
    const [row] = await db.select().from(betaCodes).where(eq(betaCodes.codeHash, hashCode(code)));
    const first = await revokeCode(row.id);
    const second = await revokeCode(row.id);
    expect(first?.id).toBe(row.id);
    expect(second).toBeUndefined(); // already revoked → WHERE matches zero rows
  });

  it("makes the code fail validateCode and claimCode (enforcement regression)", async () => {
    const [code] = await mintCodes({ count: 1 });
    track([code]);
    const [row] = await db.select().from(betaCodes).where(eq(betaCodes.codeHash, hashCode(code)));
    await revokeCode(row.id);
    expect(await validateCode(code)).toEqual({ valid: false, reason: "revoked" });
    expect(await claimCode(code, "user_x")).toEqual({ ok: false, reason: "already_used" });
  });
});
