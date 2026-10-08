// src/components/__tests__/ltc-policy-dialog.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

describe("LTC policy dialog — field ranges and the life-policy pick", () => {
  it("starting values produce no range sentence", () => {
    render(<LtcPolicyDialog {...props()} />);
    expect(screen.queryByText(/must be (at least|at most|more than|a whole)/)).toBeNull();
  });

  it("names an issue year below the schema's minimum and blocks Save", () => {
    render(<LtcPolicyDialog {...props()} />);
    fireEvent.change(screen.getByLabelText("Policy name"), { target: { value: "G" } });
    fireEvent.change(screen.getByLabelText("Issue year"), { target: { value: "218" } });
    expect(screen.getByText("Issue year must be at least 1950.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("names a home-care share above 100% and blocks Save", () => {
    render(<LtcPolicyDialog {...props()} />);
    fireEvent.change(screen.getByLabelText("Policy name"), { target: { value: "G" } });
    fireEvent.change(screen.getByLabelText("Home care pays (% of limit)"), { target: { value: "150" } });
    expect(screen.getByText("Home care pays (% of limit) must be at most 100%.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("offers 'Pick a policy' for a rider linked to an ineligible life policy, and lets the advisor fix it", () => {
    const stale: LtcPolicy = { ...POLICY, ...LTC_RIDER_DEFAULTS, lifePolicyAccountId: JOINT.id };
    render(<LtcPolicyDialog {...props({ mode: "edit", policy: stale })} />);
    const select = screen.getByLabelText("Life policy") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(Array.from(select.options).map((o) => o.textContent)).toContain("Pick a policy");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(select, { target: { value: WHOLE.id } });
    expect(screen.queryByText("The life policy must insure the same person as the rider.")).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});

// A controlled number box handed a string is rewritten whenever its text and
// the string differ, so "1.0" snapped to "1" and the next key made "15".
describe("LTC policy dialog — typing decimals", () => {
  // user-event writes String(Number(text)) into a number box (its own jsdom
  // workaround), so it can never show "1.0" — these two pin the end result.
  it("keeps '1.05' in Inflation rate as typed and saves 0.0105", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<LtcPolicyDialog {...props({ onSaved })} />);
    fireEvent.change(screen.getByLabelText("Policy name"), { target: { value: "G" } });
    const box = screen.getByLabelText("Inflation rate (%)") as HTMLInputElement;
    await user.clear(box);
    await user.type(box, "1.05");
    expect(box.value).toBe("1.05");
    await save(onSaved);
    expect(sent().inflationRate).toBe(0.0105);
  });

  it("keeps '0.5' in a rider's Monthly share of death benefit as typed and saves 0.005", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<LtcPolicyDialog {...props({ onSaved })} />);
    fireEvent.change(screen.getByLabelText("Policy name"), { target: { value: "LTC rider" } });
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "life_rider" } });
    const box = screen.getByLabelText("Monthly share of death benefit (%)") as HTMLInputElement;
    await user.clear(box);
    await user.type(box, "0.5");
    expect(box.value).toBe("0.5");
    await save(onSaved);
    expect(sent().riderMonthlyPct).toBe(0.005);
  });

  // The snap itself: a browser hands over each keystroke's text as typed,
  // which fireEvent.change reproduces in jsdom.
  it("shows the advisor's own text while typing, then re-reads the form on blur", () => {
    render(<LtcPolicyDialog {...props()} />);
    const box = screen.getByLabelText("Inflation rate (%)") as HTMLInputElement;
    for (const typed of ["1", "1.0", "1.05", "1.050"]) {
      fireEvent.change(box, { target: { value: typed } });
      expect(box.value).toBe(typed);
    }
    fireEvent.blur(box);
    expect(box.value).toBe("1.05");
  });
});
