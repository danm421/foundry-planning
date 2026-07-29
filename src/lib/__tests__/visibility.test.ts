import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/db";
import { firms, staffAdvisorVisibility } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  resolveVisibleAdvisorIds,
  VISIBLE_ALL,
  narrowToAdvisor,
  isFirmWideAdminRole,
  applyBookSwitcher,
  ALL_BOOKS,
} from "../visibility";

const FIRM = "org_vistest";

describe("resolveVisibleAdvisorIds", () => {
  beforeEach(async () => {
    await db
      .delete(staffAdvisorVisibility)
      .where(eq(staffAdvisorVisibility.firmId, FIRM));
    await db.insert(staffAdvisorVisibility).values([
      { firmId: FIRM, staffUserId: "user_ops", advisorUserId: "adv_a" },
      { firmId: FIRM, staffUserId: "user_ops", advisorUserId: "adv_b" },
    ]);
  });

  it("returns ALL for firm-wide roles", async () => {
    for (const role of ["org:owner", "org:admin", "org:member"]) {
      expect(await resolveVisibleAdvisorIds("u", role, FIRM)).toBe(VISIBLE_ALL);
    }
  });

  it("returns the mapped advisor set for staff roles", async () => {
    const visible = await resolveVisibleAdvisorIds("user_ops", "org:operations", FIRM);
    expect(visible).not.toBe(VISIBLE_ALL);
    expect([...(visible as Set<string>)].sort()).toEqual(["adv_a", "adv_b"]);
  });

  it("returns an empty set for a staff member mapped to nobody", async () => {
    const visible = await resolveVisibleAdvisorIds("user_unmapped", "org:planner", FIRM);
    expect(visible).not.toBe(VISIBLE_ALL);
    expect((visible as Set<string>).size).toBe(0);
  });
});

const SILO = "org_silo_test";

describe("resolveVisibleAdvisorIds — book siloing", () => {
  beforeEach(async () => {
    await db.delete(staffAdvisorVisibility).where(eq(staffAdvisorVisibility.firmId, SILO));
    await db.delete(firms).where(eq(firms.firmId, SILO));
  });

  it("admin sees ALL even when siloed", async () => {
    await db.insert(firms).values({ firmId: SILO, bookSiloEnabled: true });
    expect(await resolveVisibleAdvisorIds("u_admin", "org:admin", SILO)).toBe(VISIBLE_ALL);
  });

  it("advisor sees ALL when firm is NOT siloed (legacy)", async () => {
    await db.insert(firms).values({ firmId: SILO, bookSiloEnabled: false });
    expect(await resolveVisibleAdvisorIds("u_adv", "org:member", SILO)).toBe(VISIBLE_ALL);
  });

  it("advisor sees only self when siloed (shares handled separately)", async () => {
    await db.insert(firms).values({ firmId: SILO, bookSiloEnabled: true });
    const v = await resolveVisibleAdvisorIds("u_adv", "org:member", SILO);
    expect(v).not.toBe(VISIBLE_ALL);
    expect([...(v as Set<string>)].sort()).toEqual(["u_adv"]);
  });

  it("siloed advisor with no userId sees nothing", async () => {
    await db.insert(firms).values({ firmId: SILO, bookSiloEnabled: true });
    const v = await resolveVisibleAdvisorIds("", "org:member", SILO);
    expect([...(v as Set<string>)]).toEqual([]);
  });

  it("narrowToAdvisor collapses VISIBLE_ALL to a single advisor", () => {
    const n = narrowToAdvisor(VISIBLE_ALL, "u_x");
    expect([...(n as Set<string>)]).toEqual(["u_x"]);
  });
});

describe("isFirmWideAdminRole", () => {
  it("is true only for admin/owner", () => {
    expect(isFirmWideAdminRole("org:admin")).toBe(true);
    expect(isFirmWideAdminRole("org:owner")).toBe(true);
  });

  it("is false for org:member — even though that role can ALSO resolve to VISIBLE_ALL", () => {
    // This is the crux of the security gate: org:member in a non-siloed firm
    // resolves to VISIBLE_ALL too, but must never be treated as admin-narrowable.
    expect(isFirmWideAdminRole("org:member")).toBe(false);
  });

  it("is false for staff roles and null/undefined", () => {
    expect(isFirmWideAdminRole("org:operations")).toBe(false);
    expect(isFirmWideAdminRole(null)).toBe(false);
    expect(isFirmWideAdminRole(undefined)).toBe(false);
  });
});

describe("applyBookSwitcher", () => {
  // REGRESSION: this is the empty-list trap. Before applyBookSwitcher
  // existed, every call site's inline gate treated any non-empty
  // viewAsAdvisorId (including the literal "all") as "narrow to this
  // advisor" — narrowToAdvisor(visible, "all") produced Set(["all"]), an
  // advisorId IN ('all') filter matching no household, silently returning an
  // empty list to an admin who asked for "all clients".
  it('an admin passing "all" (ALL_BOOKS) gets the FULL unnarrowed visibility back, not Set(["all"])', () => {
    const result = applyBookSwitcher(VISIBLE_ALL, "org:admin", ALL_BOOKS);
    expect(result).toBe(VISIBLE_ALL);
  });

  it("an admin passing the empty string gets the input visibility back unnarrowed", () => {
    const result = applyBookSwitcher(VISIBLE_ALL, "org:admin", "");
    expect(result).toBe(VISIBLE_ALL);
  });

  it("an admin passing null/undefined gets the input visibility back unnarrowed", () => {
    expect(applyBookSwitcher(VISIBLE_ALL, "org:admin", null)).toBe(VISIBLE_ALL);
    expect(applyBookSwitcher(VISIBLE_ALL, "org:admin", undefined)).toBe(VISIBLE_ALL);
  });

  it("an admin passing a real advisorId narrows to that advisor", () => {
    const result = applyBookSwitcher(VISIBLE_ALL, "org:admin", "adv_x");
    expect(result).not.toBe(VISIBLE_ALL);
    expect([...(result as Set<string>)]).toEqual(["adv_x"]);
  });

  it("owner behaves the same as admin", () => {
    const result = applyBookSwitcher(VISIBLE_ALL, "org:owner", "adv_x");
    expect([...(result as Set<string>)]).toEqual(["adv_x"]);
  });

  // SECURITY-CRITICAL: the same guarantee narrowToAdvisor's docblock
  // requires — a non-admin's viewAsAdvisorId must never widen (or replace)
  // their own already-resolved visibility, even when it's a real advisorId.
  it("a non-admin's real advisorId does NOT widen their scope", () => {
    const staffVisible = new Set<string>(["adv_b"]);
    const result = applyBookSwitcher(staffVisible, "org:operations", "adv_x");
    expect(result).toBe(staffVisible);
  });

  it('a non-admin passing "all" is a no-op (same as missing)', () => {
    const staffVisible = new Set<string>(["adv_b"]);
    expect(applyBookSwitcher(staffVisible, "org:operations", ALL_BOOKS)).toBe(
      staffVisible,
    );
  });

  it("a non-admin's VISIBLE_ALL (non-siloed member) is left as VISIBLE_ALL, not narrowed", () => {
    // org:member can resolve to VISIBLE_ALL in a non-siloed firm (see
    // resolveVisibleAdvisorIds) but is not firm-wide-admin — narrowing this
    // would incorrectly restrict a member to a single advisor's book.
    const result = applyBookSwitcher(VISIBLE_ALL, "org:member", "adv_x");
    expect(result).toBe(VISIBLE_ALL);
  });

  it("null/undefined orgRole never narrows", () => {
    expect(applyBookSwitcher(VISIBLE_ALL, null, "adv_x")).toBe(VISIBLE_ALL);
    expect(applyBookSwitcher(VISIBLE_ALL, undefined, "adv_x")).toBe(VISIBLE_ALL);
  });
});
