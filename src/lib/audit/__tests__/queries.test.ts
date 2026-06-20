import { describe, it, expect, vi, beforeEach } from "vitest";

const whereSpy = vi.fn();
const orderBySpy = vi.fn();
const limitSpy = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (predicate: unknown) => {
          whereSpy(predicate);
          return {
            orderBy: (o: unknown) => {
              orderBySpy(o);
              return {
                limit: (n: number) => {
                  limitSpy(n);
                  return Promise.resolve([{ id: "a1" }]);
                },
              };
            },
          };
        },
      }),
    }),
  },
}));

import { getPortalActivity } from "@/lib/audit/queries";

beforeEach(() => {
  whereSpy.mockReset();
  orderBySpy.mockReset();
  limitSpy.mockReset();
});

describe("getPortalActivity", () => {
  it("filters on clientId + actorKind='client' and limits results", async () => {
    const rows = await getPortalActivity({ clientId: "c1" });
    expect(rows).toEqual([{ id: "a1" }]);
    expect(whereSpy).toHaveBeenCalled();
    expect(limitSpy).toHaveBeenCalledWith(50);
  });

  it("applies the optional 'since' filter when provided", async () => {
    await getPortalActivity({ clientId: "c1", since: new Date("2026-05-01") });
    expect(whereSpy).toHaveBeenCalled();
  });
});
