import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { firms, intakeEmailSettings } from "@/db/schema";
import { and, eq } from "drizzle-orm";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: "user_test", orgId: "firm_test", actor: null })),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(async () => {}) }));

import { auth } from "@clerk/nextjs/server";
import { GET, PUT } from "@/app/api/data-collection/email-settings/route";

const FIRM = "firm_test";
const USER = "user_test";

beforeAll(async () => {
  await db.insert(firms).values({ firmId: FIRM, displayName: "Test Firm" }).onConflictDoNothing();
});
beforeEach(async () => {
  await db.delete(intakeEmailSettings).where(eq(intakeEmailSettings.firmId, FIRM));
  vi.mocked(auth).mockResolvedValue({ userId: USER, orgId: FIRM, actor: null } as never);
});
afterAll(async () => {
  await db.delete(intakeEmailSettings).where(eq(intakeEmailSettings.firmId, FIRM));
});

function putReq(body: unknown) {
  return new NextRequest("http://t/api/data-collection/email-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET/PUT /api/data-collection/email-settings", () => {
  it("GET returns nulls when no row exists", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ fromName: null, subject: null, introBody: null, sections: null });
  });

  it("PUT then GET round-trips the saved values", async () => {
    const put = await PUT(putReq({ fromName: "Acme Wealth", subject: "Let's begin", introBody: "Hi {{clientName}}" }));
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ fromName: "Acme Wealth", subject: "Let's begin", introBody: "Hi {{clientName}}" });

    const got = await (await GET()).json();
    expect(got).toEqual({ fromName: "Acme Wealth", subject: "Let's begin", introBody: "Hi {{clientName}}", sections: null });
  });

  it("PUT upserts (second write updates the same row)", async () => {
    await PUT(putReq({ fromName: "First" }));
    await PUT(putReq({ fromName: "Second" }));
    const rows = await db.select().from(intakeEmailSettings).where(and(eq(intakeEmailSettings.firmId, FIRM), eq(intakeEmailSettings.userId, USER)));
    expect(rows).toHaveLength(1);
    expect(rows[0].fromName).toBe("Second");
  });

  it("empty strings persist as null", async () => {
    await PUT(putReq({ fromName: "", subject: "", introBody: "" }));
    expect(await (await GET()).json()).toEqual({ fromName: null, subject: null, introBody: null, sections: null });
  });

  it("does not leak another advisor's row (per-advisor scope)", async () => {
    await PUT(putReq({ fromName: "Mine" }));
    vi.mocked(auth).mockResolvedValue({ userId: "other_user", orgId: FIRM, actor: null } as never);
    expect(await (await GET()).json()).toEqual({ fromName: null, subject: null, introBody: null, sections: null });
  });

  it("GET returns 401 when there is no org", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ userId: USER, orgId: null, actor: null } as never);
    expect((await GET()).status).toBe(401);
  });
});

async function savedRow() {
  const [row] = await db
    .select()
    .from(intakeEmailSettings)
    .where(and(eq(intakeEmailSettings.firmId, FIRM), eq(intakeEmailSettings.userId, USER)));
  return row;
}

describe("email-settings sections", () => {
  it("GET returns null when the advisor has no row", async () => {
    const body = await (await GET()).json();
    expect(body.sections).toBeNull();
  });

  it("PUT normalizes and persists a section set", async () => {
    await PUT(putReq({ sections: ["risk", "family"] }));
    expect((await savedRow()).sections).toEqual(["family", "risk"]);
    expect((await (await GET()).json()).sections).toEqual(["family", "risk"]);
  });

  it("PUT updates the section default on a row that already exists", async () => {
    // Not redundant with the case above: that one lands on the INSERT arm of the
    // upsert, so it passes even if the ON CONFLICT set never writes sections.
    await PUT(putReq({ fromName: "Acme Wealth" }));
    await PUT(putReq({ sections: ["risk", "family"] }));
    expect((await savedRow()).sections).toEqual(["family", "risk"]);
  });

  it("PUT stores null when sections is null (back to the system default)", async () => {
    await PUT(putReq({ sections: ["family"] }));
    await PUT(putReq({ sections: null }));
    expect((await savedRow()).sections).toBeNull();
  });

  it("PUT rejects a set that collects nothing", async () => {
    const res = await PUT(putReq({ sections: [] }));
    expect(res.status).toBe(400);
  });

  it("saving the invitation email leaves the saved section default alone", async () => {
    // The settings page has two independent cards posting to this one row. A
    // full-replace PUT would make each save silently wipe the other's column.
    await PUT(putReq({ sections: ["family", "risk"] }));
    await PUT(putReq({ fromName: "Acme Wealth", subject: "", introBody: "" }));
    expect((await savedRow()).sections).toEqual(["family", "risk"]);
  });

  it("saving the section default leaves the invitation email alone", async () => {
    await PUT(putReq({ fromName: "Acme Wealth", subject: "Let's begin", introBody: "Hi" }));
    await PUT(putReq({ sections: ["documents"] }));
    const row = await savedRow();
    expect(row.fromName).toBe("Acme Wealth");
    expect(row.subject).toBe("Let's begin");
    expect(row.introBody).toBe("Hi");
  });

  it("an explicitly emptied field still clears — absent and empty are different", async () => {
    await PUT(putReq({ fromName: "Acme Wealth" }));
    await PUT(putReq({ fromName: "" }));
    expect((await savedRow()).fromName).toBeNull();
  });

  it("PUT rejects a set that normalizes to nothing", async () => {
    const res = await PUT(putReq({ sections: ["retired_section"] }));
    expect(res.status).toBe(400);
  });
});
