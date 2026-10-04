import { describe, it, expect } from "vitest";
import { stressTestDetail, stressTestName } from "../describe";
import { CO_CLIENT_LABEL } from "@/lib/owner-labels";
import type { ClientInfo, StressTestParams } from "@/engine/types";

const client = { firstName: "John", spouseName: "Jane Smith" } as ClientInfo;

describe("stressTestName / stressTestDetail", () => {
  it.each<[StressTestParams, string, string]>([
    [{ kind: "inflation", rate: 0.05 }, "Higher inflation — 5% a year", "Living expenses grow 5% a year"],
    [{ kind: "ss-haircut", pct: 0.23, startYear: 2034 }, "Social Security cut — 23% from 2034", "Social Security benefits cut 23% from 2034"],
    [{ kind: "tax-rates", points: 0.03, startYear: 2027 }, "Tax rates rise — 3 points from 2027", "Federal tax rates up 3 points from 2027"],
    [{ kind: "disability", person: "spouse", startYear: 2027, endYear: null }, "Disability — Jane from 2027", "Disabled from 2027"],
    [{ kind: "disability", person: "client", startYear: 2027, endYear: 2030 }, "Disability — John 2027–2030", "Disabled 2027 through 2030"],
    [{ kind: "disability", person: "client", startYear: 2027, endYear: 2027 }, "Disability — John in 2027", "Disabled in 2027"],
    [{ kind: "market-crash", year: 2027, drawdownPct: 0.3 }, "Market crash — 30% in 2027", "Investments drop 30% in 2027"],
    [{ kind: "exemption-cap", cap: 7_000_000 }, "Cap exemption growth — $7,000,000", "Estate exemption capped at $7,000,000"],
  ])("%o", (t, name, detail) => {
    expect(stressTestName(t, client)).toBe(name);
    expect(stressTestDetail(t)).toBe(detail);
  });

  it("one point is singular, and a half-point rate prints without float drift", () => {
    expect(stressTestDetail({ kind: "tax-rates", points: 0.01, startYear: 2027 })).toBe("Federal tax rates up 1 point from 2027");
    expect(stressTestDetail({ kind: "inflation", rate: 0.035 })).toBe("Living expenses grow 3.5% a year");
  });

  it("names an unnamed spouse by role, never a blank", () => {
    const solo = { firstName: "John" } as ClientInfo;
    expect(stressTestName({ kind: "disability", person: "spouse", startYear: 2027, endYear: null }, solo))
      .toBe(`Disability — ${CO_CLIENT_LABEL} from 2027`);
  });
});
