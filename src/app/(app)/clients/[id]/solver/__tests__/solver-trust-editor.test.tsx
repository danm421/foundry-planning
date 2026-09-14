// @vitest-environment jsdom
//
// Every scope asserts the control RENDERS before asserting what it emits — a
// scope that passes without its control on screen is a false negative.
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ClientData, EntitySummary } from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";
import { SolverTrustEditor } from "../solver-trust-editor";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/c1",
}));

// ── Fixture ───────────────────────────────────────────────────────────────────

const ilit: EntitySummary = {
  id: "e-ilit",
  name: "Smith Family ILIT",
  entityType: "trust",
  trustSubType: "ilit",
  isIrrevocable: true,
  isGrantor: true,
  includeInPortfolio: false,
  trustee: "Linda",
  grantor: "client",
};

/** Non-grantor, non-IDGT: cannot hold an installment-sale note. */
const nonGrantorTrust: EntitySummary = {
  id: "e-bypass",
  name: "Smith Bypass Trust",
  entityType: "trust",
  trustSubType: "irrevocable",
  isIrrevocable: true,
  isGrantor: false,
  includeInPortfolio: false,
};

const business: EntitySummary = {
  id: "e-llc",
  name: "Smith Holdings LLC",
  entityType: "llc",
  isIrrevocable: false,
  isGrantor: false,
  includeInPortfolio: true,
  value: 400_000,
  owners: [
    { kind: "entity", entityId: "e-ilit", percent: 0.6 },
    { kind: "family_member", familyMemberId: "fm-client", percent: 0.4 },
  ],
};

function tree(over: Partial<ClientData> = {}): ClientData {
  return {
    client: {
      firstName: "Sam",
      lastName: "Smith",
      dateOfBirth: "1965-04-02",
      retirementAge: 65,
      planEndAge: 95,
      filingStatus: "married_joint",
      spouseName: "Lee",
      spouseDob: "1967-06-11",
    },
    accounts: [
      {
        id: "a-brokerage",
        name: "Joint Brokerage",
        category: "taxable",
        subType: "brokerage",
        value: 750_000,
        basis: 400_000,
        growthRate: 0.06,
        rmdEnabled: false,
        titlingType: "jtwros",
        owners: [
          { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
          { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 },
        ],
      },
    ],
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings: {
      flatFederalRate: 0.24,
      flatStateRate: 0.05,
      inflationRate: 0.025,
      planStartYear: 2026,
      planEndYear: 2028,
    },
    entities: [ilit, business],
    entityFlowOverrides: [],
    familyMembers: [
      {
        id: "fm-client",
        role: "client",
        relationship: "other",
        firstName: "Sam",
        lastName: "Smith",
        dateOfBirth: "1965-04-02",
      },
      {
        id: "fm-spouse",
        role: "spouse",
        relationship: "other",
        firstName: "Lee",
        lastName: "Smith",
        dateOfBirth: "1967-06-11",
      },
    ],
    externalBeneficiaries: [],
    notesReceivable: [],
    gifts: [],
    giftEvents: [],
    ...over,
  };
}

function renderEditor(
  over: {
    entity?: EntitySummary;
    clientData?: ClientData;
    isPersisted?: boolean;
  } = {},
) {
  const onChange = vi.fn<(m: SolverMutation) => void>();
  const onRemove = vi.fn();
  render(
    <SolverTrustEditor
      clientId="c1"
      entity={over.entity ?? ilit}
      clientData={over.clientData ?? tree()}
      isPersisted={over.isPersisted ?? true}
      onChange={onChange}
      onRemove={onRemove}
    />,
  );
  return { onChange, onRemove };
}

/** Last mutation of a kind, narrowed on the discriminant (never an `as` cast). */
function lastOf<K extends SolverMutation["kind"]>(
  onChange: ReturnType<typeof vi.fn>,
  kind: K,
): Extract<SolverMutation, { kind: K }> | undefined {
  const all = onChange.mock.calls
    .map((c) => c[0] as SolverMutation)
    .filter((m): m is Extract<SolverMutation, { kind: K }> => m.kind === kind);
  return all.at(-1);
}

function allOf<K extends SolverMutation["kind"]>(
  onChange: ReturnType<typeof vi.fn>,
  kind: K,
): Extract<SolverMutation, { kind: K }>[] {
  return onChange.mock.calls
    .map((c) => c[0] as SolverMutation)
    .filter((m): m is Extract<SolverMutation, { kind: K }> => m.kind === kind);
}

// ── Details tab ───────────────────────────────────────────────────────────────

describe("SolverTrustEditor — Details tab", () => {
  it("renders the trust's current name and emits an entity-upsert on edit", async () => {
    const { onChange } = renderEditor();

    const name = screen.getByLabelText("Name");
    expect(name).toHaveValue("Smith Family ILIT");

    await userEvent.clear(name);
    await userEvent.type(name, "Renamed ILIT");

    await waitFor(() => {
      const last = lastOf(onChange, "entity-upsert");
      expect(last?.value?.name).toBe("Renamed ILIT");
      expect(last?.id).toBe("e-ilit");
    });
  });

  it("emits the distribution percent as a NUMBER, and as a FRACTION", async () => {
    const { onChange } = renderEditor();

    const liquid = screen.getByRole("button", { name: "% liquid" });
    expect(liquid).toBeInTheDocument();
    await userEvent.click(liquid);

    const pct = screen.getByLabelText("Annual percent");
    expect(pct).toHaveValue("");
    await userEvent.type(pct, "4");

    await waitFor(() => {
      const last = lastOf(onChange, "entity-upsert");
      // typeof guards the string-concatenation trap; the value guards 400%.
      expect(typeof last?.value?.distributionPercent).toBe("number");
      expect(last?.value?.distributionPercent).toBe(0.04);
      expect(last?.value?.distributionMode).toBe("pct_liquid");
    });
  });

  it("shows the trustee field, which the old solver form never had", async () => {
    const { onChange } = renderEditor();
    const trustee = screen.getByLabelText("Trustee");
    expect(trustee).toHaveValue("Linda");

    await userEvent.clear(trustee);
    await userEvent.type(trustee, "Fidelity Trust Co.");
    await waitFor(() => {
      expect(lastOf(onChange, "entity-upsert")?.value?.trustee).toBe(
        "Fidelity Trust Co.",
      );
    });
  });

  it("hands the remove request straight to the caller", async () => {
    const { onRemove } = renderEditor();
    const button = screen.getByRole("button", { name: "Remove trust" });
    expect(button).toBeInTheDocument();
    await userEvent.click(button);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

// ── Details tab: split-interest placeholder ───────────────────────────────────

describe("SolverTrustEditor — CLT/CRT terms", () => {
  it("points at the Estate Planning page instead of telling the advisor to delete the trust", () => {
    renderEditor({
      entity: {
        ...ilit,
        id: "e-clt",
        name: "Smith CLAT",
        trustSubType: "clt",
      },
    });
    expect(
      screen.getByText(/not editable in the solver yet/i),
    ).toBeInTheDocument();
    // The details page renders CltDetailsSection for an EXISTING trust
    // (add-trust-form.tsx, the `trustSubType === "clt"` block), so "remove the
    // trust and add it again" was false advice about a real trust.
    expect(screen.queryByText(/remove the trust and add it again/i)).toBeNull();
  });
});

// ── Notes tab ─────────────────────────────────────────────────────────────────

describe("SolverTrustEditor — Notes tab", () => {
  it("edits the trust's free-text note", async () => {
    const { onChange } = renderEditor();
    await userEvent.click(screen.getByRole("button", { name: "Notes" }));

    const notes = screen.getByLabelText("Notes");
    expect(notes).toHaveValue("");
    await userEvent.type(notes, "Crummey letters sent");

    await waitFor(() => {
      expect(lastOf(onChange, "entity-upsert")?.value?.notes).toBe(
        "Crummey letters sent",
      );
    });
  });
});

// ── Assets tab ────────────────────────────────────────────────────────────────

describe("SolverTrustEditor — Assets tab", () => {
  it("turns an account ownership edit into an account-upsert", async () => {
    const { onChange } = renderEditor({
      clientData: tree({
        accounts: [
          {
            id: "a-brokerage",
            name: "Joint Brokerage",
            category: "taxable",
            subType: "brokerage",
            value: 750_000,
            basis: 400_000,
            growthRate: 0.06,
            rmdEnabled: false,
            titlingType: "jtwros",
            owners: [{ kind: "entity", entityId: "e-ilit", percent: 1 }],
          },
        ],
      }),
    });
    await userEvent.click(screen.getByRole("button", { name: "Assets" }));

    const remove = screen.getByRole("button", {
      name: "Remove Joint Brokerage from trust",
    });
    expect(remove).toBeInTheDocument();
    await userEvent.click(remove);
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    const last = lastOf(onChange, "account-upsert");
    expect(last?.id).toBe("a-brokerage");
    expect(last?.value?.owners.some((o) => o.kind === "entity")).toBe(false);
  });

  it("handles a business the applyAssetTabOp helper refuses, with a numeric percent on every owner row", async () => {
    const { onChange } = renderEditor();
    await userEvent.click(screen.getByRole("button", { name: "Assets" }));

    const remove = screen.getByRole("button", {
      name: "Remove Smith Holdings LLC from trust",
    });
    expect(remove).toBeInTheDocument();
    await userEvent.click(remove);
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    const last = lastOf(onChange, "entity-upsert");
    expect(last?.id).toBe("e-llc");
    const owners = last?.value?.owners ?? [];
    // `typeof` alone cannot catch the failure D5 exists to prevent: NaN IS a
    // number, and NaN taxable income is exactly the hazard (projection.ts does
    // `netIncome * owner.percent` with no `?? 0`). So assert the VALUE too.
    // Never `==` — `"0.4" == 0.4` is true and would pass on a string.
    for (const o of owners) expect(typeof o.percent).toBe("number");
    // The fixture's cap table is trust 60% / fm-client 40%; releasing the
    // trust's 60% grows the only family row to 100%.
    expect(owners).toEqual([
      { kind: "family_member", familyMemberId: "fm-client", percent: 1 },
    ]);
  });

  it("offers no business in the picker, and says where business assignment happens", async () => {
    renderEditor();
    await userEvent.click(screen.getByRole("button", { name: "Assets" }));

    // The explanation is on the tab itself, not hidden behind the picker.
    expect(
      screen.getByText(/assigned to a trust on the Estate Planning page/i),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "+ Add asset" }));
    // The picker really opened — it still offers an account. Asserting only the
    // absences would pass on a modal that never rendered.
    expect(screen.getByLabelText("Select Joint Brokerage")).toBeInTheDocument();
    expect(screen.queryByText("Business Entities")).toBeNull();
    expect(screen.queryByLabelText("Select Smith Holdings LLC")).toBeNull();
  });
});

// ── Flows tab ─────────────────────────────────────────────────────────────────

describe("SolverTrustEditor — Flows tab", () => {
  async function openSchedule() {
    await userEvent.click(screen.getByRole("button", { name: "Flows" }));
    await userEvent.click(screen.getByRole("button", { name: "Custom schedule" }));
  }

  it("switches flow mode through the injected writer instead of the network", async () => {
    const { onChange } = renderEditor();
    await openSchedule();
    await waitFor(() => {
      expect(lastOf(onChange, "entity-upsert")?.value?.flowMode).toBe("schedule");
    });
  });

  it("posts the FULL merged row for a year the advisor touched", async () => {
    const { onChange } = renderEditor({
      clientData: tree({
        entityFlowOverrides: [
          {
            entityId: "e-ilit",
            year: 2027,
            incomeAmount: 1000,
            expenseAmount: 250,
            // A trust's grid renders no Distribution % column (the engine
            // ignores it for trusts), so it can never carry a figure here.
            distributionPercent: null,
          },
        ],
      }),
    });
    await openSchedule();

    const table = screen.getByRole("table");
    const row = within(table).getByText(/^2027 \(Age/).closest("tr")!;
    const incomeCell = within(row).getAllByRole("textbox")[0];
    expect(incomeCell).toHaveValue("1,000");
    await userEvent.clear(incomeCell);
    await userEvent.type(incomeCell, "2000");

    await userEvent.click(screen.getByRole("button", { name: "Save schedule" }));

    await waitFor(() => {
      const rows = allOf(onChange, "entity-flow-override-upsert");
      expect(rows.length).toBeGreaterThan(0);
    });
    const written = allOf(onChange, "entity-flow-override-upsert");
    expect(written).toHaveLength(1);
    expect(written[0].year).toBe(2027);
    // A whole-row replace: the two figures the advisor did NOT touch ride along.
    expect(written[0].value).toEqual({
      incomeAmount: 2000,
      expenseAmount: 250,
      distributionPercent: null,
    });
  });

  it("clears only the years the working tree actually holds", async () => {
    const { onChange } = renderEditor({
      clientData: tree({
        entityFlowOverrides: [
          {
            entityId: "e-ilit",
            year: 2027,
            incomeAmount: 1000,
            expenseAmount: null,
            distributionPercent: null,
          },
        ],
      }),
    });
    await openSchedule();

    const table = screen.getByRole("table");
    const row = within(table).getByText(/^2027 \(Age/).closest("tr")!;
    const incomeCell = within(row).getAllByRole("textbox")[0];
    expect(incomeCell).toHaveValue("1,000");
    await userEvent.clear(incomeCell);

    await userEvent.click(screen.getByRole("button", { name: "Save schedule" }));

    await waitFor(() => {
      expect(allOf(onChange, "entity-flow-override-upsert").length).toBeGreaterThan(0);
    });
    const written = allOf(onChange, "entity-flow-override-upsert");
    // 2026 and 2028 are figureless but were never set — they are NOT clears.
    expect(written).toHaveLength(1);
    expect(written[0].year).toBe(2027);
    expect(written[0].value).toBeNull();
  });
});

// ── Notes & sales tab ─────────────────────────────────────────────────────────

describe("SolverTrustEditor — Notes & sales tab", () => {
  it("hides the tab for a trust that cannot hold an installment-sale note", () => {
    renderEditor({ entity: nonGrantorTrust });
    expect(screen.queryByRole("button", { name: "Notes & sales" })).toBeNull();
  });

  it("sells an asset to a persisted trust, linking the note to it", async () => {
    const { onChange } = renderEditor();
    await userEvent.click(screen.getByRole("button", { name: "Notes & sales" }));

    expect(
      screen.getByText(/recorded when you save the scenario/i),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Sell an asset to the trust" }),
    );

    await userEvent.selectOptions(
      screen.getByLabelText("Asset to sell"),
      "a-brokerage",
    );
    await userEvent.click(screen.getByRole("button", { name: "Sell to trust" }));

    await waitFor(() => {
      expect(lastOf(onChange, "note-receivable-upsert")).toBeDefined();
    });
    const note = lastOf(onChange, "note-receivable-upsert");
    expect(note?.value?.linkedTrustEntityId).toBe("e-ilit");
    expect(note?.value?.faceValue).toBe(750_000);
    expect(typeof note?.value?.interestRate).toBe("number");
    expect(note?.value?.interestRate).toBe(0.04);
    expect(note?.value?.owners.map((o) => o.percent)).toEqual([0.5, 0.5]);

    const acct = lastOf(onChange, "account-upsert");
    expect(acct?.value?.owners).toEqual([
      { kind: "entity", entityId: "e-ilit", percent: 1 },
    ]);
  });

  it("refuses the sale for a trust the plan has never seen, rather than linking to an id with no row", async () => {
    const { onChange } = renderEditor({ isPersisted: false });
    await userEvent.click(screen.getByRole("button", { name: "Notes & sales" }));

    expect(
      screen.getByText(/save this scenario first/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Sell an asset to the trust" }),
    ).toBeNull();
    expect(lastOf(onChange, "note-receivable-upsert")).toBeUndefined();
  });
});
