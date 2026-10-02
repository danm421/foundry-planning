// @vitest-environment jsdom
/**
 * The disability policy dialog inside a scenario writes scenario changes only —
 * never the base `/disability-policies` routes (R1) — and, in base mode, still
 * issues its existing REST calls (R3).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ClientInfo, DisabilityPolicy } from "@/engine/types";

let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/clients/c1/details/insurance",
}));

import DisabilityPolicyDialog, {
  type DisabilityPolicyDialogProps,
} from "@/components/disability-policy-dialog";

const POLICY: DisabilityPolicy = {
  id: "d1",
  name: "Group disability",
  insured: "client",
  coveredEarningsMode: "salary",
  coveredEarningsAmount: null,
  shortTerm: { eliminationDays: 7, benefitPct: 0.6, durationWeeks: 13, monthlyMax: null },
  longTerm: {
    eliminationDays: 90,
    benefitPct: 0.6,
    monthlyMax: 10_000,
    benefitPeriod: { mode: "to_age", age: 65 },
  },
  benefitTaxable: true,
  colaRate: 0,
  annualPremium: 0,
  premiumPayer: "employer",
};

const CLIENT: ClientInfo = {
  firstName: "Cooper",
  lastName: "Reed",
  dateOfBirth: "1980-06-15",
  retirementAge: 65,
  planEndAge: 95,
  spouseName: "Jane",
  spouseDob: "1982-03-01",
  filingStatus: "married_joint",
};

function props(over: Record<string, unknown> = {}) {
  return {
    clientId: "c1",
    clientFirstName: "Cooper",
    spouseFirstName: "Jane",
    currentSalaryByPerson: { client: 200_000, spouse: 0 },
    currentYear: 2026,
    planStartYear: 2024,
    inflationRate: 0.03,
    planEndYear: 2060,
    client: CLIENT,
    onClose: vi.fn(),
    onSaved: vi.fn(),
    mode: "edit",
    policy: POLICY,
    ...over,
  } as unknown as DisabilityPolicyDialogProps;
}

type Call = [string, { method: string; body?: string }];
const calls = () => (global.fetch as unknown as { mock: { calls: Call[] } }).mock.calls;
const requestList = () => calls().map(([url, init]) => `${init.method} ${url}`);
const CHANGES = "POST /api/clients/c1/scenarios/scn-1/changes";

beforeEach(() => {
  searchParams = new URLSearchParams();
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }) as never;
});

describe("disability dialog in a scenario", () => {
  beforeEach(() => {
    searchParams = new URLSearchParams("scenario=scn-1");
  });

  it("edit sends ONE disability_policy edit of engine keys, no id, and nothing to the base routes", async () => {
    const onSaved = vi.fn();
    render(<DisabilityPolicyDialog {...props({ onSaved })} />);
    fireEvent.change(screen.getByLabelText("Annual premium"), { target: { value: "1200" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    expect(requestList()).toEqual([CHANGES]);
    const engineFields: Partial<DisabilityPolicy> = { ...POLICY };
    delete engineFields.id;
    expect(JSON.parse(calls()[0][1].body!)).toEqual({
      op: "edit",
      targetKind: "disability_policy",
      targetId: "d1",
      desiredFields: { ...engineFields, annualPremium: 1200 },
    });
  });

  it("create sends an add whose entity is the engine policy, with a minted id and nested layers", async () => {
    const onSaved = vi.fn();
    render(<DisabilityPolicyDialog {...props({ mode: "create", policy: undefined, onSaved })} />);
    fireEvent.change(screen.getByLabelText("Policy name"), { target: { value: "Private LTD" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    expect(requestList()).toEqual([CHANGES]);
    const body = JSON.parse(calls()[0][1].body!);
    expect(body.op).toBe("add");
    expect(body.targetKind).toBe("disability_policy");
    expect(body.targetId).toBeUndefined();
    expect(body.entity.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.entity).toMatchObject({
      name: "Private LTD",
      insured: "client",
      shortTerm: null,
      longTerm: {
        eliminationDays: 90,
        benefitPct: 0.6,
        monthlyMax: null,
        benefitPeriod: { mode: "to_age", age: 65 },
      },
    });
    // Flat wire-body keys never leak into the engine entity.
    expect(body.entity).not.toHaveProperty("hasLongTerm");
    expect(body.entity).not.toHaveProperty("ltdBenefitPct");
  });

  it("a retried create keeps the SAME id (the first attempt may have landed)", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as never;
    render(<DisabilityPolicyDialog {...props({ mode: "create", policy: undefined })} />);
    fireEvent.change(screen.getByLabelText("Policy name"), { target: { value: "Private LTD" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/could not save this policy/i);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls().length).toBe(2));
    const ids = calls().map(([, init]) => JSON.parse(init.body!).entity.id);
    expect(ids[0]).toBe(ids[1]);
  });

  it("remove sends a remove change, and nothing to the base routes", async () => {
    const onSaved = vi.fn();
    render(<DisabilityPolicyDialog {...props({ onSaved })} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove policy" }));
    fireEvent.click(screen.getByRole("button", { name: "Really remove it?" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    expect(requestList()).toEqual([CHANGES]);
    expect(JSON.parse(calls()[0][1].body!)).toEqual({
      op: "remove",
      targetKind: "disability_policy",
      targetId: "d1",
    });
  });
});

describe("disability dialog in base mode", () => {
  it("edit still PATCHes the flat body to the disability-policies route", async () => {
    const onSaved = vi.fn();
    render(<DisabilityPolicyDialog {...props({ onSaved })} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(requestList()).toEqual(["PATCH /api/clients/c1/disability-policies/d1"]);
    expect(JSON.parse(calls()[0][1].body!)).toHaveProperty("hasLongTerm", true);
  });

  it("create still POSTs, and remove still DELETEs", async () => {
    const created = vi.fn();
    const u = render(
      <DisabilityPolicyDialog {...props({ mode: "create", policy: undefined, onSaved: created })} />,
    );
    fireEvent.change(screen.getByLabelText("Policy name"), { target: { value: "Private LTD" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(created).toHaveBeenCalled());
    expect(requestList()).toEqual(["POST /api/clients/c1/disability-policies"]);
    u.unmount();

    const removed = vi.fn();
    render(<DisabilityPolicyDialog {...props({ onSaved: removed })} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove policy" }));
    fireEvent.click(screen.getByRole("button", { name: "Really remove it?" }));
    await waitFor(() => expect(removed).toHaveBeenCalled());
    expect(requestList()).toEqual([
      "POST /api/clients/c1/disability-policies",
      "DELETE /api/clients/c1/disability-policies/d1",
    ]);
  });
});
