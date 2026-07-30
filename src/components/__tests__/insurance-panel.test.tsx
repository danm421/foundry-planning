// @vitest-environment jsdom
/**
 * Inline cells on the Insurance panel.
 *
 * The decisive test here is the cash-value wire name: the accounts column is
 * `value` but the PATCH body key is `cashValue`, and
 * `insurancePolicyUpdateSchema` is a plain `z.object` that STRIPS unknown keys
 * rather than rejecting them — so `{ value: n }` parses to `{}`, updates
 * nothing, and still answers `{ ok: true }`. A wrong key there is a silent
 * no-op reported as a success.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ClientMilestones } from "@/lib/milestones";

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => null }),
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/components/insurance-policy-dialog", () => ({ default: () => null }));

import InsurancePanel, { type InsurancePanelProps } from "@/components/insurance-panel";
import { ClientAccessProvider } from "@/components/client-access-provider";

const TERM = {
  id: "p-term", name: "Term 20", category: "life_insurance" as const, subType: "term" as const,
  ownerRef: { kind: "joint" as const }, insuredPerson: "client" as const,
  value: "0", activationYear: null, activationYearRef: null,
};
const WHOLE = {
  ...TERM, id: "p-whole", name: "Whole 100", subType: "whole_life" as const,
  value: "125000", activationYear: 2030, activationYearRef: null,
};

// Field names are the real `ClientMilestones` ones (src/lib/milestones.ts) —
// `planStart`, not `planStartYear`. `resolveMilestone` reads them directly, so a
// misnamed key resolves to undefined and the year picker silently saves nothing.
const MILESTONES: ClientMilestones = {
  planStart: 2026,
  planEnd: 2060,
  clientRetirement: 2035,
  clientEnd: 2060,
  spouseRetirement: 2037,
  spouseEnd: 2062,
  clientSS62: 2030,
  clientSSFRA: 2035,
  clientSS70: 2038,
  spouseSS62: 2032,
  spouseSSFRA: 2037,
  spouseSS70: 2040,
};

function makeProps(over: Record<string, unknown> = {}) {
  return {
    clientId: "c1", clientFirstName: "Cooper", spouseFirstName: "Jane",
    accounts: [TERM, WHOLE],
    policies: {
      "p-term": { policyType: "term", faceValue: 1000000, premiumAmount: 1200 },
      "p-whole": { policyType: "whole", faceValue: 500000, premiumAmount: 9000 },
    },
    entities: [], familyMembers: [], externalBeneficiaries: [],
    modelPortfolios: [], resolvedInflationRate: 0.025,
    scheduleStartYear: 2026, scheduleEndYear: 2060,
    milestones: MILESTONES,
    ...over,
    // `as unknown as` and NOT `as never`: `never` is assignable anywhere but a
    // JSX spread of it is TS2698 ("Spread types may only be created from object
    // types"). The double cast is what lets the three-key policy stand-ins
    // stand in for a full `LifeInsurancePolicy` — the panel reads exactly three
    // of its fields.
  } as unknown as InsurancePanelProps;
}

function mount(over: Record<string, unknown> = {}, permission: "edit" | "view" = "edit") {
  return render(
    <ClientAccessProvider value={{ permission, access: "own" }}>
      <InsurancePanel {...makeProps(over)} />
    </ClientAccessProvider>,
  );
}

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as never;
});

/** The body of the single PATCH the last interaction fired. */
function patchBody(): Record<string, unknown> {
  const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  expect(calls).toHaveLength(1);
  const [, init] = calls[0] as [string, { method: string; body: string }];
  expect(init.method).toBe("PATCH");
  return JSON.parse(init.body);
}

describe("InsurancePanel inline cells", () => {
  it("makes face value editable", () => {
    mount();
    expect(screen.getByRole("button", { name: "Edit amount for Whole 100 face value" }))
      .toBeInTheDocument();
  });

  it("makes premium editable", () => {
    mount();
    expect(screen.getByRole("button", { name: "Edit amount for Whole 100 premium" }))
      .toBeInTheDocument();
  });

  it("offers a cash-value editor on a whole-life policy", () => {
    mount();
    expect(screen.getByRole("button", { name: "Edit amount for Whole 100 cash value" }))
      .toBeInTheDocument();
  });

  it("does NOT offer a cash-value editor on a term policy — it has none", () => {
    mount();
    expect(screen.queryByRole("button", { name: "Edit amount for Term 20 cash value" }))
      .not.toBeInTheDocument();
  });

  it("keeps its table header row, with a permanent Activation column", () => {
    mount();
    const heads = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads).toContain("Face value");
    expect(heads).toContain("Activation");
  });

  // C1: the decisive one. `value` is the DB column; `cashValue` is the wire name, and
  // the update schema STRIPS unknown keys and still answers 200, so a wrong key here is
  // a silent no-op that reports success.
  it("sends cash value as `cashValue`, not `value`", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Edit amount for Whole 100 cash value" }));
    const input = screen.getByRole("textbox", { name: "Amount for Whole 100 cash value" });
    fireEvent.change(input, { target: { value: "200000" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(patchBody()).toEqual({ cashValue: 200000 });
  });

  it("sends face value as `faceValue`", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Edit amount for Whole 100 face value" }));
    const input = screen.getByRole("textbox", { name: "Amount for Whole 100 face value" });
    fireEvent.change(input, { target: { value: "750000" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(patchBody()).toEqual({ faceValue: 750000 });
  });

  // C7: the anchor travels with the year, or the next milestone move silently
  // re-derives over the manual one.
  it("sends activationYearRef alongside activationYear", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Change activation year for Whole 100" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Activation year for Whole 100" }), {
      target: { value: "client_retirement" },
    });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(patchBody()).toEqual({ activationYear: 2035, activationYearRef: "client_retirement" });
  });

  // C5: null activationYear means already in force. There is no InlineYearCell
  // rendering of that, and no way back to null, so it is read-only text.
  it("renders an in-force policy as read-only text, with no year control", () => {
    mount();
    expect(screen.getByText("In force")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change activation year for Term 20" }))
      .not.toBeInTheDocument();
  });

  // C8: offering a spouse to a household that has none writes a nonsense insured.
  it("omits spouse and joint from the insured picker when there is no spouse", () => {
    mount({ spouseFirstName: null });
    fireEvent.click(screen.getByRole("button", { name: "Change insured for Whole 100" }));
    const options = Array.from(
      screen.getByRole("combobox", { name: "Insured for Whole 100" }).querySelectorAll("option"),
    ).map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(["client"]);
  });

  // C2: InlineAmount has no canEdit of its own, and the pre-existing read-only test
  // cannot see these names.
  it("renders no amount editors under permission=view, but still shows the values", () => {
    mount({}, "view");
    expect(screen.queryByRole("button", { name: /^Edit amount for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Change /})).not.toBeInTheDocument();
    expect(screen.getByText("$500,000")).toBeInTheDocument();
  });
});
