// @vitest-environment jsdom
/**
 * The Disability panel on the Insurance details page.
 *
 * The decisive tests here are about what the panel is allowed to SEND.
 * `disabilityPolicyUpdateSchema` validates the PATCH BODY, never the merged
 * row — `validateCrossFields` only ever sees the keys the request carried — so
 * the screen is the only thing standing between an advisor and a policy that
 * covers nothing:
 *
 *  - `{hasShortTerm:false}` alone passes, and so does `{hasLongTerm:false}`.
 *    Two one-key PATCHes therefore leave a policy covering NEITHER, the exact
 *    invariant a POST refuses. The dialog must send the pair.
 *  - A body carrying `hasLongTerm:true` but no benefit-period keys comes back
 *    reporting `{mode:"to_age", age:65}` on a row whose age column is NULL —
 *    a 65 nobody entered. Turning long-term coverage on means shipping the
 *    whole long-term block.
 *  - `stdMonthlyMax: null` means UNCAPPED. A form control that round-trips it
 *    as 0 silently pays nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ClientInfo, DisabilityPolicy } from "@/engine/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import DisabilityPanel, {
  type DisabilityPanelProps,
} from "@/components/disability-panel";
import { ClientAccessProvider } from "@/components/client-access-provider";
import { WORKPLACE_DEFAULTS } from "@/lib/schemas/disability-policies";

const WORKPLACE: DisabilityPolicy = {
  id: "d1",
  name: "Group disability",
  insured: "client",
  coveredEarningsMode: "salary",
  coveredEarningsAmount: null,
  // `monthlyMax: null` is the real group-STD shape and the whole point of the
  // round-trip test below — group short-term is usually uncapped.
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

function makeProps(over: Partial<DisabilityPanelProps> = {}): DisabilityPanelProps {
  return {
    clientId: "c1",
    policies: [WORKPLACE],
    clientFirstName: "Cooper",
    spouseFirstName: "Jane",
    currentSalaryByPerson: { client: 200_000, spouse: 0 },
    currentYear: 2026,
    planEndYear: 2060,
    client: CLIENT,
    ...over,
  };
}

function renderPanel(
  permission: "view" | "edit",
  over: Partial<DisabilityPanelProps> = {},
) {
  return render(
    <ClientAccessProvider value={{ permission, access: "own" }}>
      <DisabilityPanel {...makeProps(over)} />
    </ClientAccessProvider>,
  );
}

function fetchMock() {
  return global.fetch as unknown as {
    mock: { calls: [string, { method: string; body: string }][] };
  };
}

/** The body of the LAST request fired, plus its method and URL. */
function lastRequest() {
  const calls = fetchMock().mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const [url, init] = calls[calls.length - 1];
  return { url, method: init.method, body: JSON.parse(init.body) as Record<string, unknown> };
}

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ policy: { ...WORKPLACE, id: "d1" } }),
  }) as never;
});

describe("DisabilityPanel", () => {
  it("shows an empty state that names what is missing", () => {
    // The empty state's own subtitle and headers are a claim — it must not
    // promise coverage the client does not have.
    renderPanel("edit", { policies: [] });
    expect(screen.getByText(/no disability coverage/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add workplace coverage/i }),
    ).toBeInTheDocument();
  });

  it("summarises a policy as what it pays, not as its stored fields", () => {
    renderPanel("edit");
    expect(screen.getByText(/60% to age 65/i)).toBeInTheDocument();
    expect(screen.getByText(/\$10,000\/mo cap/i)).toBeInTheDocument();
  });

  it("marks a policy taxable or tax-free", () => {
    renderPanel("edit");
    expect(screen.getByText(/taxable/i)).toBeInTheDocument();
  });

  it("hides both add buttons when the viewer has read-only access", () => {
    const withPolicy = renderPanel("view");
    // Vacuity guard: a component that renders NOTHING satisfies every
    // "the button is absent" assertion below, so prove the panel drew first.
    expect(screen.getByRole("heading", { name: "Disability" })).toBeInTheDocument();
    expect(screen.getByText("Group disability")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /add/i })).toHaveLength(0);
    withPolicy.unmount();

    renderPanel("view", { policies: [] });
    expect(screen.getByText(/no disability coverage/i)).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /add/i })).toHaveLength(0);
  });

  it("adds workplace coverage from the shared defaults, keeping an uncapped max null", async () => {
    // No spouse: there is only one person to insure, so the button acts
    // straight away rather than asking who.
    renderPanel("edit", { policies: [], spouseFirstName: null });
    fireEvent.click(screen.getByRole("button", { name: /add workplace coverage/i }));

    await waitFor(() => expect(fetchMock().mock.calls.length).toBe(1));
    const req = lastRequest();
    expect(req.method).toBe("POST");
    expect(req.url).toBe("/api/clients/c1/disability-policies");
    expect(req.body).toEqual({ ...WORKPLACE_DEFAULTS, insured: "client" });
    // Explicit, because `toEqual` treats a missing key and an undefined one
    // alike: an uncapped short-term max must travel as a real null.
    expect(req.body.stdMonthlyMax).toBeNull();
  });

  it("surfaces a failed add in the panel rather than an alert", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as never;
    renderPanel("edit", { policies: [], spouseFirstName: null });
    fireEvent.click(screen.getByRole("button", { name: /add workplace coverage/i }));

    expect(await screen.findByText(/could not add coverage/i)).toBeInTheDocument();
  });

  it("sends hasShortTerm and hasLongTerm together when a coverage block is switched off", async () => {
    // A one-key PATCH passes validation and can leave the policy covering
    // neither — validateCrossFields never sees the stored row, only the body.
    renderPanel("edit");
    fireEvent.click(screen.getByRole("button", { name: "Edit Group disability" }));
    fireEvent.click(screen.getByRole("switch", { name: "Short-term coverage" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock().mock.calls.length).toBe(1));
    const req = lastRequest();
    expect(req.method).toBe("PATCH");
    expect(req.body).toHaveProperty("hasShortTerm", false);
    expect(req.body).toHaveProperty("hasLongTerm"); // the pair, not the one
    expect(req.body.hasLongTerm).toBe(true);
  });

  it("ships the whole long-term block whenever long-term coverage is on", async () => {
    // `{hasShortTerm:true, hasLongTerm:true}` obeys the pairing table and STILL
    // fabricates: on a row whose age column is NULL the response reports
    // `{mode:"to_age", age:65}`. The mode and its companion must travel too.
    renderPanel("edit");
    fireEvent.click(screen.getByRole("button", { name: "Edit Group disability" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock().mock.calls.length).toBe(1));
    const req = lastRequest();
    expect(req.body).toHaveProperty("hasLongTerm", true);
    expect(req.body).toHaveProperty("ltdBenefitPeriodMode", "to_age");
    expect(req.body).toHaveProperty("ltdBenefitPeriodAge", 65);
  });

  it("round-trips an uncapped monthly max as null, never as zero", async () => {
    renderPanel("edit");
    fireEvent.click(screen.getByRole("button", { name: "Edit Group disability" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock().mock.calls.length).toBe(1));
    const req = lastRequest();
    expect(req.body.stdMonthlyMax).toBeNull();
    expect(req.body.ltdMonthlyMax).toBe(10_000);
  });

  it("scopes a missing date of birth to long-term coverage", () => {
    // `resolveCoverage` builds the short-term window from `policy.shortTerm`
    // alone and never consults a date of birth, so short-term still resolves and
    // the projection still pays it. A blanket "this policy pays nothing" would
    // contradict the short-term line rendered right beside it — the same defect
    // Task 8's reviewer fixed in the timeline.
    renderPanel("edit", {
      policies: [{ ...WORKPLACE, insured: "spouse" }],
      client: { ...CLIENT, spouseDob: undefined },
      currentSalaryByPerson: { client: 200_000, spouse: 150_000 },
    });
    expect(screen.getByText(/no date of birth/i).textContent).toMatch(/long-term/i);
    expect(screen.getByText(/60% for 13 weeks/i)).toBeInTheDocument();
  });

  it("says why a policy with no covered earnings pays nothing", () => {
    // Salary mode with no salary rows for the insured — a non-earning spouse,
    // or rows that end before this year. Both bands render at $0/mo and nothing
    // gates them on earnings, so the row must say why.
    renderPanel("edit", { currentSalaryByPerson: { client: 0, spouse: 0 } });
    expect(screen.getByText(/no covered earnings/i)).toBeInTheDocument();
  });

  it("explains the short-term duration and the taxable switch in the dialog", () => {
    renderPanel("edit");
    fireEvent.click(screen.getByRole("button", { name: "Edit Group disability" }));
    expect(
      screen.getByText(
        /Counted from the first day of disability, so the waiting period is inside it\./i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Benefits are taxable when the employer pays the premium, and tax-free when you pay it with after-tax dollars\./i,
      ),
    ).toBeInTheDocument();
  });
});
