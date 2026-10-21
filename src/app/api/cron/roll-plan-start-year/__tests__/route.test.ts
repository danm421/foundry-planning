import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  selectStale: vi.fn(),
  update: vi.fn(),
  recordAudit: vi.fn(),
  lt: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ innerJoin: () => ({ where: () => mocks.selectStale() }) }) }),
    update: () => ({ set: (values: unknown) => ({ where: () => mocks.update(values) }) }),
  },
}));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    lt: (...args: Parameters<typeof actual.lt>) => {
      mocks.lt(...args);
      return actual.lt(...args);
    },
  };
});

import { GET } from "../route";
import { planSettings } from "@/db/schema";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // 00:10 US Eastern on New Year's Day — the cron's first run of 2027.
  vi.setSystemTime(new Date("2027-01-01T05:10:00Z"));
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.update.mockResolvedValue(undefined);
  mocks.recordAudit.mockResolvedValue(undefined);
  process.env.CRON_SECRET = "secret_t";
});
afterEach(() => {
  vi.useRealTimers();
});

const authed = () =>
  new Request("http://test/api/cron/roll-plan-start-year", {
    headers: { authorization: "Bearer secret_t" },
  }) as never;

const stale = (id: string, planStartYear: number) => ({ id, clientId: `c-${id}`, firmId: `f-${id}`, planStartYear });

describe("GET /api/cron/roll-plan-start-year", () => {
  it("rejects a missing or incorrect secret", async () => {
    const res = await GET(new Request("http://test") as never);
    expect(res.status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("moves every plan still on last year", async () => {
    mocks.selectStale.mockResolvedValue([stale("ps1", 2026), stale("ps2", 2026)]);
    const res = await GET(authed());
    expect(await res.json()).toEqual({ moved: 2, thisYear: 2027 });
    // Only rows BEFORE this year are selected — a plan already starting in
    // 2027 (the switch was on) is left alone.
    expect(mocks.lt).toHaveBeenCalledWith(planSettings.planStartYear, 2027);
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.update.mock.calls[0][0]).toMatchObject({ planStartYear: 2027, updatedAt: expect.any(Date) });
    expect(mocks.recordAudit).toHaveBeenCalledTimes(2);
    expect(mocks.recordAudit).toHaveBeenCalledWith({
      action: "plan_settings.start_year_roll",
      resourceType: "plan_settings",
      resourceId: "ps1",
      clientId: "c-ps1",
      firmId: "f-ps1",
      actorId: "system:roll-plan-start-year",
      actorKind: "system",
      metadata: { from: 2026, to: 2027 },
    });
  });

  it("moves a start year several years behind straight to this year", async () => {
    mocks.selectStale.mockResolvedValue([stale("ps1", 2024)]);
    await GET(authed());
    expect(mocks.update.mock.calls[0][0]).toMatchObject({ planStartYear: 2027 });
    expect(mocks.recordAudit.mock.calls[0][0].metadata).toEqual({ from: 2024, to: 2027 });
  });

  it("is a no-op the next day", async () => {
    mocks.selectStale.mockResolvedValue([]);
    const res = await GET(authed());
    expect(await res.json()).toEqual({ moved: 0, thisYear: 2027 });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("logs and skips a row that fails, and keeps going", async () => {
    mocks.selectStale.mockResolvedValue([stale("ps1", 2026), stale("ps2", 2026)]);
    mocks.update.mockRejectedValueOnce(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(authed());
    expect(await res.json()).toEqual({ moved: 1, thisYear: 2027 });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
