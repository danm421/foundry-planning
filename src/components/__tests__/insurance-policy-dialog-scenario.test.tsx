// @vitest-environment jsdom
/**
 * The policy dialog inside a scenario writes scenario changes only — never the
 * base `/insurance-policies` routes (R1) — and, in base mode, still issues its
 * existing REST calls (R3).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ClientMilestones } from "@/lib/milestones";

let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/clients/c1/details/insurance",
}));

import InsurancePolicyDialog, {
  type InsurancePolicyDialogProps,
} from "@/components/insurance-policy-dialog";

const MILESTONES: ClientMilestones = {
  planStart: 2026, planEnd: 2060,
  clientRetirement: 2035, clientEnd: 2060,
  spouseRetirement: 2037, spouseEnd: 2062,
  clientSS62: 2030, clientSSFRA: 2035, clientSS70: 2038,
  spouseSS62: 2032, spouseSSFRA: 2037, spouseSS70: 2040,
};
const CLIENT_FM = "11111111-1111-4111-8111-111111111111";
const SPOUSE_FM = "22222222-2222-4222-8222-222222222222";
const MP = "44444444-4444-4444-8444-444444444444";

const WHOLE_ACCOUNT = {
  id: "p-whole", name: "Whole 100", category: "life_insurance", subType: "whole_life",
  ownerRef: { kind: "joint" }, insuredPerson: "client", value: "125000",
  activationYear: null, activationYearRef: null,
};
const WHOLE_POLICY = {
  faceValue: 500000, costBasis: 40000, premiumAmount: 9000, premiumYears: null,
  premiumPayer: "owner", policyType: "whole", termIssueYear: null, termLengthYears: null,
  endsAtInsuredRetirement: false, cashValueGrowthMode: "basic",
  premiumScheduleMode: "off", deathBenefitScheduleMode: "off", incomeScheduleMode: "off",
  postPayoutGrowthRate: 0.06, postPayoutModelPortfolioId: null, cashValueSchedule: [],
};

function props(over: Record<string, unknown> = {}) {
  return {
    clientId: "c1", clientFirstName: "Michael", spouseFirstName: "Sarah",
    accounts: [WHOLE_ACCOUNT], policies: { "p-whole": WHOLE_POLICY },
    entities: [],
    familyMembers: [
      { id: CLIENT_FM, firstName: "Michael", lastName: "S", relationship: "child", role: "client", dateOfBirth: null, notes: null },
      { id: SPOUSE_FM, firstName: "Sarah", lastName: "S", relationship: "child", role: "spouse", dateOfBirth: null, notes: null },
    ],
    externalBeneficiaries: [],
    modelPortfolios: [{ id: MP, name: "Conservative", blendedReturn: 0.05 }],
    resolvedInflationRate: 0.025, scheduleStartYear: 2026, scheduleEndYear: 2060,
    milestones: MILESTONES, mode: "edit" as const, policyId: "p-whole", onClose: vi.fn(),
    ...over,
  } as unknown as InsurancePolicyDialogProps;
}

type Call = [string, { method: string; body?: string }];
const calls = () => (global.fetch as unknown as { mock: { calls: Call[] } }).mock.calls;
const requestList = () => calls().map(([url, init]) => `${init.method} ${url}`);

beforeEach(() => {
  searchParams = new URLSearchParams();
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }) as never;
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

function changeFace(value: string) {
  fireEvent.change(screen.getByLabelText(/Death benefit/), { target: { value } });
}
const submit = () => fireEvent.submit(document.getElementById("insurance-policy-form")!);

describe("policy dialog in a scenario", () => {
  beforeEach(() => {
    searchParams = new URLSearchParams("scenario=scn-1");
  });

  it("edit sends ONE account edit carrying every field, and nothing to the base routes", async () => {
    render(<InsurancePolicyDialog {...props()} />);
    changeFace("750000");
    submit();
    await waitFor(() => expect(calls().length).toBeGreaterThan(0));

    expect(requestList()).toEqual(["POST /api/clients/c1/scenarios/scn-1/changes"]);
    const body = JSON.parse(calls()[0][1].body!);
    expect(body).toMatchObject({ op: "edit", targetKind: "account", targetId: "p-whole" });
    expect(body.desiredFields).toMatchObject({
      name: "Whole 100",
      subType: "whole_life",
      insuredPerson: "client",
      value: 125000,
      owners: [
        { kind: "family_member", familyMemberId: CLIENT_FM, percent: 0.5 },
        { kind: "family_member", familyMemberId: SPOUSE_FM, percent: 0.5 },
      ],
      lifeInsurance: {
        faceValue: 750000, costBasis: 40000, premiumAmount: 9000, policyType: "whole",
        postPayoutGrowthRate: 0.06, postPayoutModelPortfolioId: null,
      },
    });
  });

  it("delete sends an account remove, and nothing to the base routes", async () => {
    render(<InsurancePolicyDialog {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete policy" }));
    await waitFor(() => expect(calls().length).toBeGreaterThan(0));

    expect(requestList()).toEqual(["POST /api/clients/c1/scenarios/scn-1/changes"]);
    expect(JSON.parse(calls()[0][1].body!)).toEqual({
      op: "remove", targetKind: "account", targetId: "p-whole",
    });
  });
});

describe("policy dialog in base mode", () => {
  it("edit still PATCHes the base route", async () => {
    render(<InsurancePolicyDialog {...props()} />);
    changeFace("750000");
    submit();
    await waitFor(() => expect(calls().length).toBeGreaterThan(0));
    expect(requestList()).toEqual(["PATCH /api/clients/c1/insurance-policies/p-whole"]);
  });

  it("delete still DELETEs the base route", async () => {
    render(<InsurancePolicyDialog {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete policy" }));
    await waitFor(() => expect(calls().length).toBeGreaterThan(0));
    expect(requestList()).toEqual(["DELETE /api/clients/c1/insurance-policies/p-whole"]);
  });
});
