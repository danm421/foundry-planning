// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import QuickEditDrawer from "../quick-edit-drawer";
import type { ClientMilestones } from "@/lib/milestones";
import type { ExpenseView, IncomeView } from "@/lib/scenario/view-adapters";

// `vi.hoisted` so the hoisted `vi.mock` factory can close over a value the
// tests mutate per case (a bare `let` would still be in its TDZ when the
// factory first runs).
const nav = vi.hoisted(() => ({ scenario: null as string | null }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({
    get: (key: string) => (key === "scenario" ? nav.scenario : null),
    toString: () => (nav.scenario ? `scenario=${nav.scenario}` : ""),
  }),
  usePathname: () => "/clients/client-1/details/map",
}));

// Real uuids: `forFamilyMemberId` is validated as one on the write path, so a
// "fm-kelly" placeholder would let a test pass a body the API would 400.
const FM_KELLY = "11111111-1111-4111-8111-111111111111";
const FM_SAM = "22222222-2222-4222-8222-222222222222";
const FM_PAT = "33333333-3333-4333-8333-333333333333";

// The beneficiary list every render helper below passes. Three shapes on
// purpose — they are the three branches of `handleForChange`: a child whose
// college years are still ahead (Kelly, 2030-2033), one with no usable DOB at
// all (Sam — the dates must not move), and one already past 18 (Pat, whose
// start floors at the plan's first year rather than landing in 2008).
const FAMILY_MEMBERS = [
  { id: FM_KELLY, firstName: "Kelly", birthYear: 2012 },
  { id: FM_SAM, firstName: "Sam", birthYear: null },
  { id: FM_PAT, firstName: "Pat", birthYear: 1990 },
];

const milestones: ClientMilestones = {
  planStart: 2026,
  planEnd: 2066,
  clientRetirement: 2045,
  clientEnd: 2066,
};

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  nav.scenario = null;
  vi.restoreAllMocks();
});

function expenseRow(overrides: Partial<ExpenseView> = {}): ExpenseView {
  return {
    id: "exp-1",
    type: "other",
    name: "Expense",
    annualAmount: "10000",
    startYear: 2028,
    endYear: 2030,
    startYearRef: null,
    endYearRef: null,
    growthRate: "0.03",
    growthSource: "custom",
    isGoal: false,
    isDefault: false,
    ...overrides,
  };
}

function incomeRow(overrides: Partial<IncomeView> = {}): IncomeView {
  return {
    id: "inc-1",
    type: "salary",
    name: "Salary",
    annualAmount: "90000",
    startYear: 2026,
    endYear: 2045,
    owner: "client",
    claimingAge: null,
    growthRate: "0.03",
    growthSource: "inflation",
    startYearRef: null,
    endYearRef: null,
    ...overrides,
  };
}

function renderExpense(row: ExpenseView) {
  return render(
    <QuickEditDrawer
      clientId="client-1"
      target={{ kind: "expense", id: row.id, row, presetColumn: "joint" }}
      clientFirstName="Alex"
      spouseFirstName="Jordan"
      milestones={milestones}
      resolvedInflationRate={0.03}
      familyMembers={FAMILY_MEMBERS}
      onClose={() => {}}
    />,
  );
}

/** Captures every `fetch` call so a test can pick the write it cares about by
 *  URL rather than by call index. */
function captureFetch() {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  global.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    // Pre-fix, the drawer GET-ed the base-case list endpoint on mount. Answer
    // it with the BASE row so a regression to that read path is visible as
    // base numbers landing in the write payload (see the save-path test).
    if (String(url).endsWith("/expenses")) {
      return {
        ok: true,
        json: async () => [expenseRow({ id: "exp-1", name: "Mortgage", annualAmount: "24000" })],
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }) as unknown as typeof fetch;
  return calls;
}

describe("QuickEditDrawer — goal checkbox (Task 11 brief, Step 2)", () => {
  it("is checked AND disabled for an education expense, with the locked-goal helper text", () => {
    renderExpense(expenseRow({ id: "exp-1", type: "education", name: "College" }));

    const checkbox = screen.getByRole("checkbox", { name: /Show as a goal/ });
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeDisabled();
    expect(screen.getByText(/Education expenses are always goals/)).toBeInTheDocument();
  });

  it("is UNCHECKED and editable for a non-education, non-goal expense — the discriminating case", () => {
    renderExpense(expenseRow({ id: "exp-2", type: "other", name: "New roof", isGoal: false }));

    const checkbox = screen.getByRole("checkbox", { name: /Show as a goal/ });
    expect(checkbox).not.toBeChecked();
    expect(checkbox).not.toBeDisabled();
    expect(screen.queryByText(/Education expenses are always goals/)).not.toBeInTheDocument();
  });

  it("is checked (but still editable) for a non-education expense that already opted in via isGoal", () => {
    renderExpense(expenseRow({ id: "exp-3", type: "other", name: "Boat", isGoal: true }));

    const checkbox = screen.getByRole("checkbox", { name: /Show as a goal/ });
    expect(checkbox).toBeChecked();
    expect(checkbox).not.toBeDisabled();
  });

  it("does not render an Owner select for an expense (owner is incomes-only)", () => {
    renderExpense(expenseRow({ id: "exp-4", type: "living", name: "Rent" }));

    expect(screen.getByRole("checkbox", { name: /Show as a goal/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("Owner")).not.toBeInTheDocument();
  });

  it("renders an Owner select (Client/Spouse/Joint) for an income and no goal checkbox", () => {
    const row = incomeRow({ owner: "spouse" });
    render(
      <QuickEditDrawer
        clientId="client-1"
        target={{ kind: "income", id: row.id, row, presetColumn: "joint" }}
        clientFirstName="Alex"
        spouseFirstName="Jordan"
        milestones={milestones}
        resolvedInflationRate={0.03}
        familyMembers={FAMILY_MEMBERS}
        onClose={() => {}}
      />,
    );

    const ownerSelect = screen.getByLabelText("Owner");
    expect((ownerSelect as HTMLSelectElement).value).toBe("spouse");
    expect(screen.queryByText("Show as a goal")).not.toBeInTheDocument();
  });
});

describe("QuickEditDrawer — save path", () => {
  // The drawer submits EVERY field it renders, and the scenario changes-writer
  // replaces the change payload wholesale. So if the form were hydrated from
  // the base-case list-GET (as it was pre-fix), a save inside a scenario would
  // write base values over that scenario's own overrides — pressing Save with
  // no edits at all would silently revert the scenario. This test pins the
  // effective row as the hydration source by making the base row differ.
  it("scenario mode: submits the EFFECTIVE row's values, not the base case's", async () => {
    nav.scenario = "sc-1";
    const calls = captureFetch();

    // Effective (scenario) row — every field differs from the base row the
    // captured fetch would answer a list-GET with.
    const row = expenseRow({
      id: "exp-1",
      name: "Mortgage (scenario)",
      annualAmount: "31000",
      startYear: 2031,
      endYear: 2051,
      growthRate: "0.05",
      isGoal: true,
    });
    renderExpense(row);

    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(calls.some((c) => c.url.includes("/changes"))).toBe(true);
    });

    const write = calls.find((c) => c.url.includes("/changes"))!;
    expect(write.url).toBe("/api/clients/client-1/scenarios/sc-1/changes");
    const body = JSON.parse(String(write.init?.body)) as {
      op: string;
      targetKind: string;
      targetId: string;
      desiredFields: Record<string, unknown>;
    };
    expect(body.op).toBe("edit");
    expect(body.targetKind).toBe("expense");
    expect(body.targetId).toBe("exp-1");
    expect(body.desiredFields.name).toBe("Mortgage (scenario)");
    expect(body.desiredFields.annualAmount).toBe("31000");
    expect(body.desiredFields.startYear).toBe("2031");
    expect(body.desiredFields.endYear).toBe("2051");
    expect(body.desiredFields.growthRate).toBe("0.05");
    expect(body.desiredFields.isGoal).toBe(true);
  });

  it("never fetches on mount — the effective row arrives as a prop", () => {
    const calls = captureFetch();
    renderExpense(expenseRow({ id: "exp-1" }));
    expect(calls).toHaveLength(0);
  });
});

describe("QuickEditDrawer — delete confirmation", () => {
  it("requires a second, confirming click before deleting, and Cancel backs out", async () => {
    const calls = captureFetch();
    renderExpense(expenseRow({ id: "exp-1", name: "New roof" }));

    // First click only arms the confirm — nothing is written.
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(calls).toHaveLength(0);
    expect(screen.getByText("Delete?")).toBeInTheDocument();

    // Cancel disarms it.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Delete?")).not.toBeInTheDocument();
    expect(calls).toHaveLength(0);

    // Arm again, then confirm — now the DELETE goes out.
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toBe("/api/clients/client-1/expenses/exp-1");
    expect(calls[0].init?.method).toBe("DELETE");
  });

  it("hides Delete entirely for a protected default expense", () => {
    renderExpense(expenseRow({ id: "exp-1", isDefault: true, name: "Living expenses" }));
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });
});

describe("QuickEditDrawer — create mode seeded as a goal", () => {
  function renderNewGoal(presetIsGoal: boolean) {
    return render(
      <QuickEditDrawer
        clientId="client-1"
        target={{
          kind: "expense",
          id: null,
          row: null,
          presetColumn: "joint",
          presetIsGoal,
        }}
        clientFirstName="Alex"
        spouseFirstName="Jordan"
        milestones={milestones}
        resolvedInflationRate={0.03}
        familyMembers={FAMILY_MEMBERS}
        onClose={() => {}}
      />,
    );
  }

  it("pre-ticks 'Show as a goal'", () => {
    renderNewGoal(true);
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  // The control against the above: without the preset the same create-mode
  // drawer must still open unticked, or the assertion above is passing on a
  // default rather than on the preset.
  it("leaves it unticked without the preset", () => {
    renderNewGoal(false);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("titles itself 'Add Goal' so the click that opened it is legible", () => {
    renderNewGoal(true);
    expect(screen.getByRole("dialog", { name: "Add Goal" })).toBeInTheDocument();
  });

  it("still titles itself 'Add Expense' without the preset", () => {
    renderNewGoal(false);
    expect(screen.getByRole("dialog", { name: "Add Expense" })).toBeInTheDocument();
  });

  it("sends isGoal on the create so the row lands back on the Goals board", async () => {
    const calls = captureFetch();
    renderNewGoal(true);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New roof" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const post = calls.find((c) => c.url.endsWith("/expenses") && c.init?.method === "POST");
      expect(post).toBeDefined();
      expect(JSON.parse(String(post!.init!.body)).isGoal).toBe(true);
    });
  });
});

// An education goal was unreachable from the Map before this: "Add goal" could
// only ever create a `type: "other"` expense, so the one goal shape the Goals
// board renders specially — "for Kelly", "College · State U" — had to be built
// on /details/income-expenses and could not be added where it is displayed.
//
// The type picker is CREATE-mode only, deliberately. An existing education row
// also carries `institutionState`, `payShortfallOutOfPocket` and a
// `dedicatedAccountIds` join this drawer does not render, so retyping one here
// would strand all three pointing at a type the row no longer is. Creating has
// nothing to strand.
describe("QuickEditDrawer — education goals", () => {
  function renderNewExpense() {
    return render(
      <QuickEditDrawer
        clientId="client-1"
        // No `presetIsGoal` — so "Show as a goal" opens UNTICKED, and the
        // force-tick assertions below cannot be passing on the Goals board's
        // preset instead of on the education type.
        target={{ kind: "expense", id: null, row: null, presetColumn: "joint" }}
        clientFirstName="Alex"
        spouseFirstName="Jordan"
        milestones={milestones}
        resolvedInflationRate={0.03}
        familyMembers={FAMILY_MEMBERS}
        onClose={() => {}}
      />,
    );
  }

  /** Save is gated on a non-empty name (`disabled={saving || !name.trim()}`).
   *  Picking a beneficiary auto-titles the goal and satisfies that on its own;
   *  a case that saves WITHOUT one has to type a name first, or it is asserting
   *  against a button that never fired. */
  function nameIt(value: string) {
    fireEvent.change(screen.getByLabelText("Name"), { target: { value } });
  }

  /** Save, then return the parsed create POST body. */
  async function saveAndReadBody(calls: ReturnType<typeof captureFetch>) {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(calls.some((c) => c.init?.method === "POST")).toBe(true);
    });
    const post = calls.find((c) => c.init?.method === "POST")!;
    expect(post.url).toBe("/api/clients/client-1/expenses");
    return JSON.parse(String(post.init!.body)) as Record<string, unknown>;
  }

  describe("the type picker", () => {
    it("renders in create mode, defaulting to Other", () => {
      renderNewExpense();

      const select = screen.getByLabelText("Type") as HTMLSelectElement;
      expect(select.value).toBe("other");
      expect([...select.options].map((o) => o.value)).toEqual([
        "living",
        "insurance",
        "education",
        "other",
      ]);
    });

    it("is ABSENT in edit mode — retyping an existing row belongs to the full editor", () => {
      renderExpense(expenseRow({ id: "exp-1", type: "education", name: "College" }));

      expect(screen.queryByLabelText("Type")).not.toBeInTheDocument();
    });

    it("does not offer a type on an income (the picker is expenses-only)", () => {
      const row = incomeRow();
      render(
        <QuickEditDrawer
          clientId="client-1"
          target={{ kind: "income", id: null, row: null, presetColumn: "client" }}
          clientFirstName="Alex"
          spouseFirstName="Jordan"
          milestones={milestones}
          resolvedInflationRate={0.03}
          familyMembers={FAMILY_MEMBERS}
          onClose={() => {}}
        />,
      );
      expect(row.type).toBe("salary"); // fixture sanity — the income shape exists
      expect(screen.queryByLabelText("Type")).not.toBeInTheDocument();
    });
  });

  describe("choosing Education", () => {
    it("reveals the beneficiary and institution fields, which are hidden for every other type", () => {
      renderNewExpense();

      expect(screen.queryByLabelText("For")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Institution")).not.toBeInTheDocument();

      fireEvent.change(screen.getByLabelText("Type"), { target: { value: "education" } });

      expect(screen.getByLabelText("For")).toBeInTheDocument();
      expect(screen.getByLabelText("Institution")).toBeInTheDocument();
    });

    it("force-ticks 'Show as a goal'", () => {
      renderNewExpense();
      expect(screen.getByRole("checkbox", { name: /Show as a goal/ })).not.toBeChecked();

      fireEvent.change(screen.getByLabelText("Type"), { target: { value: "education" } });

      expect(screen.getByRole("checkbox", { name: /Show as a goal/ })).toBeChecked();
    });

    // Separate case from the tick: a checkbox that is checked but still
    // clickable can be un-ticked one click later, and the row would then be an
    // education expense the Goals board never draws.
    it("disables 'Show as a goal' and says why", () => {
      renderNewExpense();
      fireEvent.change(screen.getByLabelText("Type"), { target: { value: "education" } });

      expect(screen.getByRole("checkbox", { name: /Show as a goal/ })).toBeDisabled();
      expect(screen.getByText(/Education expenses are always goals/)).toBeInTheDocument();
    });

    // The lock follows the CURRENT type, not a one-way latch: switching back has
    // to hand the checkbox and the two fields back.
    it("releases the lock and hides the fields when the type is switched back", () => {
      renderNewExpense();
      fireEvent.change(screen.getByLabelText("Type"), { target: { value: "education" } });
      fireEvent.change(screen.getByLabelText("Type"), { target: { value: "other" } });

      const checkbox = screen.getByRole("checkbox", { name: /Show as a goal/ });
      expect(checkbox).not.toBeDisabled();
      expect(checkbox).not.toBeChecked();
      expect(screen.queryByLabelText("For")).not.toBeInTheDocument();
    });
  });

  describe("picking a beneficiary", () => {
    function pickEducationFor(fmId: string) {
      renderNewExpense();
      fireEvent.change(screen.getByLabelText("Type"), { target: { value: "education" } });
      fireEvent.change(screen.getByLabelText("For"), { target: { value: fmId } });
    }

    it("titles the goal after them", () => {
      pickEducationFor(FM_KELLY);
      expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Kelly - Education");
    });

    // Kelly turns 18 in 2030, so the goal is 2030-2033. Asserted on the SAVE
    // payload rather than on the year pickers because the payload is what
    // reaches the DB — and because `startYearRef`/`endYearRef` have no rendered
    // form of their own.
    it("time-boxes it to a four-year program starting the year they turn 18", async () => {
      const calls = captureFetch();
      pickEducationFor(FM_KELLY);

      const body = await saveAndReadBody(calls);
      expect(body.startYear).toBe("2030");
      expect(body.endYear).toBe("2033");
    });

    // THE ONE THAT MATTERS. Both refs seed to plan_start/plan_end, and on every
    // future load a ref OUTRANKS the stored year (`resolvedStart`/`resolvedEnd`).
    // A surviving ref would quietly stretch a four-year college goal back across
    // the whole projection the next time the page loaded — and the years above
    // would still have been written correctly, so nothing else would show it.
    it("clears BOTH milestone refs alongside the years", async () => {
      const calls = captureFetch();
      pickEducationFor(FM_KELLY);

      const body = await saveAndReadBody(calls);
      expect(body.startYearRef).toBeNull();
      expect(body.endYearRef).toBeNull();
    });

    // The control for both of the above: without a beneficiary the same create
    // keeps the seeded plan_start/plan_end refs, so "the refs are null" cannot
    // be passing on a drawer that never sends refs at all.
    it("leaves the seeded refs in place when no beneficiary is picked", async () => {
      const calls = captureFetch();
      renderNewExpense();
      fireEvent.change(screen.getByLabelText("Type"), { target: { value: "education" } });
      nameIt("College fund");

      const body = await saveAndReadBody(calls);
      expect(body.startYearRef).toBe("plan_start");
      expect(body.endYearRef).toBe("plan_end");
    });

    // A beneficiary with no usable DOB still titles the goal — but must not
    // guess a year. `handleForChange` returns before touching the dates.
    it("names the goal but does not move the dates for a member with no birth year", async () => {
      const calls = captureFetch();
      pickEducationFor(FM_SAM);

      expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Sam - Education");
      const body = await saveAndReadBody(calls);
      expect(body.startYear).toBe("2026");
      expect(body.startYearRef).toBe("plan_start");
    });

    // Pat turned 18 in 2008. The start floors at the plan's first year rather
    // than opening a goal that began eighteen years before the projection does.
    it("floors the start at the plan's first year for a beneficiary already past 18", async () => {
      const calls = captureFetch();
      pickEducationFor(FM_PAT);

      const body = await saveAndReadBody(calls);
      expect(body.startYear).toBe("2026");
      expect(body.endYear).toBe("2029");
    });
  });

  describe("the create payload", () => {
    it("carries the type, the beneficiary, the institution and isGoal", async () => {
      const calls = captureFetch();
      renderNewExpense();
      fireEvent.change(screen.getByLabelText("Type"), { target: { value: "education" } });
      fireEvent.change(screen.getByLabelText("For"), { target: { value: FM_KELLY } });
      fireEvent.change(screen.getByLabelText("Institution"), { target: { value: "State U" } });

      const body = await saveAndReadBody(calls);
      expect(body.type).toBe("education");
      expect(body.forFamilyMemberId).toBe(FM_KELLY);
      expect(body.institutionName).toBe("State U");
      // Forced, not toggled — the checkbox was never clicked and the drawer
      // opened without `presetIsGoal`.
      expect(body.isGoal).toBe(true);
    });

    // `forFamilyMemberId` is uuid-validated on the write path: "" is a 400, not
    // "no beneficiary". Same for a whitespace-only institution.
    it("sends null — never the empty string — for an unpicked beneficiary and a blank institution", async () => {
      const calls = captureFetch();
      renderNewExpense();
      fireEvent.change(screen.getByLabelText("Type"), { target: { value: "education" } });
      fireEvent.change(screen.getByLabelText("Institution"), { target: { value: "   " } });
      nameIt("College fund");

      const body = await saveAndReadBody(calls);
      expect(body.forFamilyMemberId).toBeNull();
      expect(body.institutionName).toBeNull();
    });

    // The education keys are education-only. A "living" expense carrying a
    // `forFamilyMemberId: null` would be a field the row has no business having.
    it("omits the education keys entirely for a non-education create", async () => {
      const calls = captureFetch();
      renderNewExpense();
      fireEvent.change(screen.getByLabelText("Type"), { target: { value: "living" } });
      nameIt("Groceries");

      const body = await saveAndReadBody(calls);
      expect(body.type).toBe("living");
      expect(body).not.toHaveProperty("forFamilyMemberId");
      expect(body).not.toHaveProperty("institutionName");
    });
  });
});
