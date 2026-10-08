// src/components/__tests__/ltc-policy-dialog.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { LtcPolicy } from "@/engine/types";
import { LTC_RIDER_DEFAULTS, LTC_STANDALONE_DEFAULTS, ltcPolicyCreateSchema } from "@/lib/schemas/ltc-policies";

let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/clients/c1/details/insurance",
}));

import LtcPolicyDialog, { type LtcPolicyDialogProps } from "@/components/ltc-policy-dialog";

const WHOLE = { id: "20000000-0000-4000-8000-000000000001", name: "Whole Life", insuredPerson: "client" as const, faceValue: 500_000 };
const JOINT = { id: "20000000-0000-4000-8000-000000000002", name: "Survivorship", insuredPerson: "joint" as const, faceValue: 1_000_000 };
const POLICY: LtcPolicy = {
  id: "ltc-1", name: "Genworth", insured: "client", carrier: null, issueYear: 2018,
  ...LTC_STANDALONE_DEFAULTS, annualPremium: 2400, partnership: false, notes: null,
};

function props(over: Record<string, unknown> = {}) {
  return {
    clientId: "c1", clientFirstName: "Cooper", spouseFirstName: "Jane", lifePolicies: [WHOLE, JOINT],
    currentYear: 2026, onClose: vi.fn(), onSaved: vi.fn(), mode: "create", ...over,
  } as unknown as LtcPolicyDialogProps;
}

type Call = [string, { method: string; body?: string }];
const calls = () => (global.fetch as unknown as { mock: { calls: Call[] } }).mock.calls;
const sent = (i = 0) => JSON.parse(calls()[i][1].body!);

beforeEach(() => {
  searchParams = new URLSearchParams();
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }) as never;
});

async function save(onSaved: ReturnType<typeof vi.fn>) {
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
}

describe("LTC policy dialog — base mode", () => {
  it("creates a traditional policy from the starting values with one POST of the whole form", async () => {
    const onSaved = vi.fn();
    render(<LtcPolicyDialog {...props({ onSaved })} />);
    fireEvent.change(screen.getByLabelText("Policy name"), { target: { value: " Genworth " } });
    await save(onSaved);
    expect(calls().map(([u, i]) => `${i.method} ${u}`)).toEqual(["POST /api/clients/c1/ltc-policies"]);
    const body = sent();
    expect(body).toMatchObject({ name: "Genworth", kind: "standalone", benefitAmount: 6000, benefitPeriodYears: 3, issueYear: 2026, lifePolicyAccountId: null });
    expect(ltcPolicyCreateSchema.safeParse(body).success).toBe(true);
  });

  it("blocks Save with a sentence when the issue year is cleared", () => {
    render(<LtcPolicyDialog {...props()} />);
    fireEvent.change(screen.getByLabelText("Policy name"), { target: { value: "G" } });
    fireEvent.change(screen.getByLabelText("Issue year"), { target: { value: "" } });
    expect(screen.getByText("Enter the year the policy was issued.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

describe("LTC policy dialog — riders", () => {
  it("offers a rider only on the insured's own, non-joint life policy", () => {
    render(<LtcPolicyDialog {...props()} />);
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "life_rider" } });
    const options = Array.from((screen.getByLabelText("Life policy") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toEqual(["Whole Life"]);
  });

  it("disables the rider type, with a hint, when the insured has no life policy", () => {
    render(<LtcPolicyDialog {...props()} />);
    fireEvent.change(screen.getByLabelText("Who is covered"), { target: { value: "spouse" } });
    const rider = screen.getByRole("option", { name: "Rider on a life policy" }) as HTMLOptionElement;
    expect(rider.disabled).toBe(true);
    expect(screen.getByText(/No life policy on file for Jane/)).toBeInTheDocument();
  });

  it("saves a rider with no premium and no benefit period, and reads back what it pays", async () => {
    const onSaved = vi.fn();
    render(<LtcPolicyDialog {...props({ onSaved })} />);
    fireEvent.change(screen.getByLabelText("Policy name"), { target: { value: "LTC rider" } });
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "life_rider" } });
    expect(screen.getByText("Pays up to $10,000/mo for about 50 months; at least $0 left to heirs.")).toBeInTheDocument();
    await save(onSaved);
    expect(sent()).toMatchObject({
      kind: "life_rider", lifePolicyAccountId: WHOLE.id, annualPremium: 0, premiumPayMode: "paid_up",
      benefitPeriodMode: null, riderMonthlyPct: 0.02,
    });
  });

  // Review Focus 3.
  it("leaves no rider fields behind after switching Rider → Traditional", async () => {
    const onSaved = vi.fn();
    render(<LtcPolicyDialog {...props({ onSaved })} />);
    fireEvent.change(screen.getByLabelText("Policy name"), { target: { value: "G" } });
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "life_rider" } });
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "standalone" } });
    await save(onSaved);
    expect(sent()).toMatchObject({ kind: "standalone", lifePolicyAccountId: null, riderMonthlyPct: null, riderMaxPct: null });
    expect(ltcPolicyCreateSchema.safeParse(sent()).success).toBe(true);
  });

  // Review Focus 1: the rider's life policy is not in this scenario's tree.
  it("blocks Save on a rider whose life policy is missing, without crashing", () => {
    const orphan: LtcPolicy = { ...POLICY, ...LTC_RIDER_DEFAULTS, lifePolicyAccountId: "20000000-0000-4000-8000-0000000000ff" };
    render(<LtcPolicyDialog {...props({ mode: "edit", policy: orphan })} />);
    expect(screen.getByText("Its life policy isn't in this scenario. Pick another one.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

describe("LTC policy dialog — in a scenario", () => {
  beforeEach(() => {
    searchParams = new URLSearchParams("scenario=scn-1");
  });

  it("edit sends ONE ltc_policy edit of every field but the id, and nothing to the base routes", async () => {
    const onSaved = vi.fn();
    render(<LtcPolicyDialog {...props({ onSaved, mode: "edit", policy: POLICY })} />);
    fireEvent.change(screen.getByLabelText("Annual premium"), { target: { value: "3000" } });
    await save(onSaved);
    expect(calls().map(([u, i]) => `${i.method} ${u}`)).toEqual(["POST /api/clients/c1/scenarios/scn-1/changes"]);
    const fields: Partial<LtcPolicy> = { ...POLICY };
    delete fields.id;
    expect(sent()).toEqual({ op: "edit", targetKind: "ltc_policy", targetId: "ltc-1", desiredFields: { ...fields, annualPremium: 3000 } });
  });

  it("create sends ONE ltc_policy add carrying a fresh id", async () => {
    const onSaved = vi.fn();
    render(<LtcPolicyDialog {...props({ onSaved })} />);
    fireEvent.change(screen.getByLabelText("Policy name"), { target: { value: "G" } });
    await save(onSaved);
    const body = sent();
    expect(body).toMatchObject({ op: "add", targetKind: "ltc_policy", entity: { name: "G", kind: "standalone" } });
    expect(body.entity.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("removes on the second click through the scenario writer", async () => {
    const onSaved = vi.fn();
    render(<LtcPolicyDialog {...props({ onSaved, mode: "edit", policy: POLICY })} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove policy" }));
    fireEvent.click(screen.getByRole("button", { name: "Really remove it?" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(sent()).toEqual({ op: "remove", targetKind: "ltc_policy", targetId: "ltc-1" });
  });
});
