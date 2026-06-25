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
    expect(await res.json()).toEqual({ fromName: null, subject: null, introBody: null });
  });

  it("PUT then GET round-trips the saved values", async () => {
    const put = await PUT(putReq({ fromName: "Acme Wealth", subject: "Let's begin", introBody: "Hi {{clientName}}" }));
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ fromName: "Acme Wealth", subject: "Let's begin", introBody: "Hi {{clientName}}" });

    const got = await (await GET()).json();
    expect(got).toEqual({ fromName: "Acme Wealth", subject: "Let's begin", introBody: "Hi {{clientName}}" });
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
    expect(await (await GET()).json()).toEqual({ fromName: null, subject: null, introBody: null });
  });

  it("does not leak another advisor's row (per-advisor scope)", async () => {
    await PUT(putReq({ fromName: "Mine" }));
    vi.mocked(auth).mockResolvedValue({ userId: "other_user", orgId: FIRM, actor: null } as never);
    expect(await (await GET()).json()).toEqual({ fromName: null, subject: null, introBody: null });
  });

  it("GET returns 401 when there is no org", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ userId: USER, orgId: null, actor: null } as never);
    expect((await GET()).status).toBe(401);
  });
});
