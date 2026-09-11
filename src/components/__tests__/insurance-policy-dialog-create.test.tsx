// @vitest-environment jsdom
/**
 * "Add policy" create path.
 *
 * The decisive fact: a new policy's owner has to be resolved from the family
 * members that arrive as props. It used to sit in `DEFAULT_STATE` as the
 * placeholder `{ kind: "family", id: "" }`, and an empty id matches no
 * `<option>` — so the Owner select rendered BLANK, an advisor who never opened
 * it posted that empty id, and the create schema's uuid check bounced it back
 * as the opaque "Invalid body". The same unresolved ref also read as "not a
 * household principal", putting the gift-only "Paid by" field on what is
 * really a client-owned policy.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ClientMilestones } from "@/lib/milestones";
import { insurancePolicyCreateSchema } from "@/lib/schemas/insurance-policies";

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => null }),
  useRouter: () => ({ refresh: vi.fn() }),
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
const TRUST = "33333333-3333-4333-8333-333333333333";
const MP = "44444444-4444-4444-8444-444444444444";

function props(over: Record<string, unknown> = {}) {
  return {
    clientId: "c1",
    clientFirstName: "Michael",
    spouseFirstName: "Sarah",
    accounts: [],
    policies: {},
    entities: [{ id: TRUST, name: "Michael ILIT", entityType: "irrevocable_trust", crummeyPowers: true }],
    familyMembers: [
      { id: CLIENT_FM, firstName: "Michael", lastName: "S", relationship: "self", role: "client", dateOfBirth: "1970-01-01", notes: null },
      { id: SPOUSE_FM, firstName: "Sarah", lastName: "S", relationship: "spouse", role: "spouse", dateOfBirth: "1972-01-01", notes: null },
    ],
    externalBeneficiaries: [],
    modelPortfolios: [{ id: MP, name: "Conservative (30/70)", blendedReturn: 0.0544 }],
    resolvedInflationRate: 0.025,
    scheduleStartYear: 2026,
    scheduleEndYear: 2060,
    milestones: MILESTONES,
    mode: "create" as const,
    onClose: vi.fn(),
    ...over,
    // `as unknown as`, not `as never`: `never` is assignable anywhere, but a
    // JSX spread of it is TS2698 ("Spread types may only be created from
    // object types").
  } as unknown as InsurancePolicyDialogProps;
}

/** Body of the single POST the submit fired, parsed. */
function postBody(): Record<string, unknown> {
  const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  const [, init] = calls[0] as [string, { method: string; body: string }];
  expect(init.method).toBe("POST");
  return JSON.parse(init.body);
}

/** Fill the fields the browser's own `required` would otherwise block on, so
 *  what's left is exactly what the API can still reject. */
function fillTermFields() {
  fireEvent.change(screen.getByLabelText("Term issue year"), { target: { value: "2026" } });
  fireEvent.change(screen.getByLabelText("Term length (years)"), { target: { value: "20" } });
  fireEvent.change(screen.getByLabelText(/Death benefit/), { target: { value: "1000000" } });
}

function submit() {
  fireEvent.submit(document.getElementById("insurance-policy-form")!);
}

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "new" }) }) as never;
});

describe("Add policy → create", () => {
  it("posts an owner the API accepts when the advisor never opens the Owner select", async () => {
    render(<InsurancePolicyDialog {...props()} />);
    fillTermFields();
    submit();

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const parsed = insurancePolicyCreateSchema.safeParse(postBody());
    expect(
      parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    ).toEqual([]);
  });

  it("defaults the owner to the client, so the gift-only Paid by field stays hidden", () => {
    render(<InsurancePolicyDialog {...props()} />);
    expect(screen.queryByLabelText(/Paid by/)).not.toBeInTheDocument();
  });

  it("still shows Paid by — naming the trust — for a trust-owned policy", async () => {
    render(<InsurancePolicyDialog {...props()} />);
    fireEvent.change(screen.getByLabelText("Owner"), {
      target: { value: JSON.stringify({ kind: "entity", id: TRUST }) },
    });
    fireEvent.change(screen.getByLabelText(/Paid by/), { target: { value: "client" } });
    expect(screen.getByText(/gifts to Michael ILIT/)).toBeInTheDocument();

    fillTermFields();
    submit();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const parsed = insurancePolicyCreateSchema.safeParse(postBody());
    expect(
      parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    ).toEqual([]);
  });

  it("falls back to joint ownership when the household has no client row", () => {
    render(<InsurancePolicyDialog {...props({ familyMembers: [] })} />);
    expect(screen.queryByLabelText(/Paid by/)).not.toBeInTheDocument();
  });

  it("shows a rejected save as the field to fix, not the route's 'Invalid body'", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: "Invalid body",
        issues: [{ path: "faceValue", message: "Invalid input: expected number, received NaN" }],
      }),
    }) as never;

    render(<InsurancePolicyDialog {...props()} />);
    fillTermFields();
    submit();

    expect(await screen.findByText("Death benefit: enter a number.")).toBeInTheDocument();
    expect(screen.queryByText(/Invalid body/)).not.toBeInTheDocument();
  });
});
