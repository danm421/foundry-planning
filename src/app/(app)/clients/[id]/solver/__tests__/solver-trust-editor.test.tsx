// @vitest-environment jsdom
//
// Every scope asserts the control RENDERS before asserting what it emits — a
// scope that passes without its control on screen is a false negative.
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ClientData, EntitySummary } from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";
import { partitionBaseSavableMutations } from "@/lib/solver/mutations-to-base-updates";
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

// ── Tab visibility ───────────────────────────────────────────────────────────
//
// Every tab body is always in the DOM behind Tailwind's `hidden`, and jsdom
// applies no stylesheet — so `toBeVisible()` is blind here and a broken
// `setTab` passed every other scope in this file. The browser pass that would
// have caught it was skipped on the owner's instruction and is not coming back.
//
// jsdom cannot apply the class, but it can read it. The invariant asserted is
// the whole of what the class does: EXACTLY ONE body lacks `hidden`, and it is
// the one whose tab is selected. That fails on a `setTab` that ignores its
// argument, on one that sets the wrong id, and on a body whose className
// forgets to branch at all.

describe("SolverTrustEditor — tab visibility", () => {
  /** The wrapper divs, keyed by the tab they belong to. */
  const panels = () =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-tab-panel]")).map((el) => ({
      tab: el.dataset.tabPanel!,
      hidden: el.className.split(/\s+/).includes("hidden"),
    }));

  const TABS: Array<[string, string]> = [
    ["Details", "details"],
    ["Assets", "assets"],
    ["Transfers", "transfers"],
    ["Flows", "flows"],
    ["Notes & sales", "notes-sales"],
    ["Notes", "notes"],
  ];

  it("renders one wrapper per tab, so the assertions below are not vacuous", () => {
    renderEditor();
    expect(panels().map((p) => p.tab)).toEqual(TABS.map(([, id]) => id));
  });

  it.each(TABS)("shows only the %s body when its tab is clicked", async (label, id) => {
    renderEditor();
    await userEvent.click(screen.getByRole("button", { name: label }));
    const shown = panels().filter((p) => !p.hidden);
    expect(shown.map((p) => p.tab)).toEqual([id]);
  });

  it("starts on Details with every other body hidden", () => {
    renderEditor();
    expect(panels().filter((p) => !p.hidden).map((p) => p.tab)).toEqual(["details"]);
  });

  it("drops the Notes & sales wrapper entirely for a trust that cannot hold a note", () => {
    renderEditor({ entity: nonGrantorTrust });
    expect(panels().map((p) => p.tab)).not.toContain("notes-sales");
    // …and the remaining five still obey the invariant.
    expect(panels().filter((p) => !p.hidden)).toHaveLength(1);
  });
});

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
    // Minor 1: the old sentence promised a gift row for every assignment, but
    // a revocable trust, a child-owned business, or a non-client/spouse
    // grantor produces none (assets/route.ts:210, :229-231, :154-159). The
    // softened sentence must not repeat that promise.
    expect(
      screen.getByText(/the transfer and any taxable gift are recorded/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/the transfer is recorded as a taxable gift/i),
    ).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "+ Add asset" }));
    // The picker really opened — it still offers an account. Asserting only the
    // absences would pass on a modal that never rendered.
    expect(screen.getByLabelText("Select Joint Brokerage")).toBeInTheDocument();
    expect(screen.queryByText("Business Entities")).toBeNull();
    expect(screen.queryByLabelText("Select Smith Holdings LLC")).toBeNull();
  });

  it("says nothing about business assignment when the plan holds no businesses", async () => {
    // Paired with the test above, which proves the copy IS present when a
    // business exists. An absence-only assertion would pass on a
    // queryByText that could never match anything.
    renderEditor({ clientData: tree({ entities: [ilit] }) });
    await userEvent.click(screen.getByRole("button", { name: "Assets" }));

    expect(
      screen.queryByText(/assigned to a trust on the Estate Planning page/i),
    ).toBeNull();
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

  // ── ⚠️(d): the producer side of the Save-to-base pairing ────────────────────
  //
  // `submitSaleToTrust` emits TWO mutations for this one action — the source
  // account's owner flip into the trust, and the note the family now holds — and
  // ties them together with the note's `sourceAccountId`. That one field is what
  // stops Save to base from posting the flip ALONE and permanently retitling the
  // asset into the trust on the client's REAL record with nothing owed for it.
  //
  // The consumer side is pinned in mutations-to-base-updates.test.ts and
  // live-solver-workspace.test.tsx, but both hand-seed the payload — so without
  // this scope, dropping or renaming `sourceAccountId` here, or emitting the
  // paired `account-upsert` under a different id, leaves every one of those
  // tests green while production half-saves the sale again.
  it("ties the note to the account it sold, so Save to base cannot take the asset without the note", async () => {
    const { onChange } = renderEditor();
    await userEvent.click(screen.getByRole("button", { name: "Notes & sales" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Sell an asset to the trust" }),
    );

    // The control RENDERS before anything is asserted about what it emits.
    const assetSelect = screen.getByLabelText("Asset to sell");
    expect(assetSelect).toBeInTheDocument();
    await userEvent.selectOptions(assetSelect, "a-brokerage");
    await userEvent.click(screen.getByRole("button", { name: "Sell to trust" }));

    await waitFor(() => {
      expect(lastOf(onChange, "note-receivable-upsert")).toBeDefined();
    });
    const note = lastOf(onChange, "note-receivable-upsert")!;
    const acct = lastOf(onChange, "account-upsert")!;
    expect(acct).toBeDefined();

    // Read the pairing off the EMITTED mutations, never off a literal: the fact
    // under test is that the producer ties its own two halves together, not that
    // it happened to pick any particular account id.
    expect(note.sourceAccountId).toBeTruthy();
    expect(note.sourceAccountId).toBe(acct.id);

    // …and that this is the pairing the Save-to-base split actually reads. Running
    // the REAL emitted pair through the REAL partition pins the dependency rather
    // than a field name: if the producer stops declaring its source account, the
    // owner flip lands back in `savable` and goes to the client's real record on
    // its own.
    const { savable, heldSaleAccountIds } = partitionBaseSavableMutations([acct, note]);
    expect(savable).toEqual([]);
    expect(heldSaleAccountIds).toEqual([acct.id]);
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
