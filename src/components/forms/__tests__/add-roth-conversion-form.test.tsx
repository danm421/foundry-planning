// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

import AddRothConversionForm from "../add-roth-conversion-form";

const refreshMock = vi.fn();
let searchParamsMock: URLSearchParams;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
  useSearchParams: () => searchParamsMock,
  usePathname: () => "/clients/client-123",
}));

const ACCOUNTS = [
  { id: "acc-roth", name: "Roth IRA", category: "retirement", subType: "roth_ira" },
  { id: "acc-trad", name: "Traditional IRA", category: "retirement", subType: "traditional_ira" },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  refreshMock.mockReset();
  searchParamsMock = new URLSearchParams("");
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ id: "rc-1" }),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function fillFormAndSubmit() {
  fireEvent.change(screen.getByPlaceholderText("e.g., Roth Conversion 1"), {
    target: { value: "Conv A" },
  });
  // Pick the only available source account
  fireEvent.click(screen.getByRole("button", { name: /\+ Add/i }));
  // Trigger submit
  fireEvent.click(screen.getByRole("button", { name: "Add Conversion" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
}

describe("AddRothConversionForm — base mode", () => {
  it("POSTs to /api/clients/<id>/roth-conversions", async () => {
    render(
      <AddRothConversionForm
        clientId="client-123"
        accounts={ACCOUNTS}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    // Set fixed amount > 0
    const amountInput = screen.getByLabelText(/Fixed Amount/i);
    fireEvent.change(amountInput, { target: { value: "10000" } });

    await fillFormAndSubmit();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/clients/client-123/roth-conversions");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.name).toBe("Conv A");
    expect(body.destinationAccountId).toBe("acc-roth");
    expect(body.sourceAccountIds).toEqual(["acc-trad"]);
  });
});

describe("AddRothConversionForm — source owner filtering", () => {
  const OWNED_ACCOUNTS = [
    { id: "roth-client", name: "Client Roth", category: "retirement", subType: "roth_ira", ownerFamilyMemberId: "fm-client" },
    { id: "roth-spouse", name: "Spouse Roth", category: "retirement", subType: "roth_ira", ownerFamilyMemberId: "fm-spouse" },
    { id: "trad-client", name: "Client Trad IRA", category: "retirement", subType: "traditional_ira", ownerFamilyMemberId: "fm-client" },
    { id: "trad-spouse", name: "Spouse Trad IRA", category: "retirement", subType: "traditional_ira", ownerFamilyMemberId: "fm-spouse" },
  ];

  it("only offers source accounts owned by the destination Roth's owner", () => {
    render(
      <AddRothConversionForm
        clientId="client-123"
        accounts={OWNED_ACCOUNTS}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    // Destination defaults to the first Roth (client-owned).
    expect(screen.getByText("Client Trad IRA")).toBeInTheDocument();
    expect(screen.queryByText("Spouse Trad IRA")).not.toBeInTheDocument();
  });

  it("re-filters and prunes selected sources when the destination owner changes", () => {
    render(
      <AddRothConversionForm
        clientId="client-123"
        accounts={OWNED_ACCOUNTS}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    // Select the client-owned source.
    fireEvent.click(screen.getByRole("button", { name: /\+ Add/i }));
    expect(screen.getByText("1.")).toBeInTheDocument();

    // Switch destination to the spouse-owned Roth.
    fireEvent.change(screen.getByLabelText(/Destination Account/i), {
      target: { value: "roth-spouse" },
    });

    // Client source is pruned; spouse source is now the only option.
    expect(screen.queryByText("1.")).not.toBeInTheDocument();
    expect(screen.getByText("Spouse Trad IRA")).toBeInTheDocument();
    expect(screen.queryByText("Client Trad IRA")).not.toBeInTheDocument();
  });
});

describe("AddRothConversionForm — scenario mode", () => {
  it("posts an `add` change to /scenarios/<sid>/changes", async () => {
    searchParamsMock = new URLSearchParams("scenario=sid-1");

    render(
      <AddRothConversionForm
        clientId="client-123"
        accounts={ACCOUNTS}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    const amountInput = screen.getByLabelText(/Fixed Amount/i);
    fireEvent.change(amountInput, { target: { value: "10000" } });

    await fillFormAndSubmit();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/clients/client-123/scenarios/sid-1/changes");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.op).toBe("add");
    expect(body.targetKind).toBe("roth_conversion");
    expect(body.entity.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.entity.name).toBe("Conv A");
    expect(body.entity.sourceAccountIds).toEqual(["acc-trad"]);
  });

  it("posts an `edit` change with desiredFields when initialData is provided", async () => {
    searchParamsMock = new URLSearchParams("scenario=sid-1");

    render(
      <AddRothConversionForm
        clientId="client-123"
        accounts={ACCOUNTS}
        initialData={{
          id: "rc-1",
          name: "Existing Conv",
          destinationAccountId: "acc-roth",
          sourceAccountIds: ["acc-trad"],
          conversionType: "fixed_amount",
          fixedAmount: "10000",
          fillUpBracket: null,
          startYear: 2030,
          startYearRef: null,
          endYear: 2034,
          endYearRef: null,
          indexingRate: "0",
          inflationStartYear: null,
        }}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/clients/client-123/scenarios/sid-1/changes");
    const body = JSON.parse(init.body);
    expect(body.op).toBe("edit");
    expect(body.targetKind).toBe("roth_conversion");
    expect(body.targetId).toBe("rc-1");
    expect(body.desiredFields.name).toBe("Existing Conv");
    expect(body.desiredFields.fixedAmount).toBe(10000);
  });
});

describe("AddRothConversionForm — draft mode", () => {
  it("calls onSubmitDraft with a RothConversion object and does NOT call fetch", async () => {
    const onSubmitDraft = vi.fn();
    const onSaved = vi.fn();

    render(
      <AddRothConversionForm
        clientId="client-123"
        accounts={ACCOUNTS}
        onClose={() => {}}
        onSaved={onSaved}
        onSubmitDraft={onSubmitDraft}
      />,
    );

    // Set fixed amount to 25000
    const amountInput = screen.getByLabelText(/Fixed Amount/i);
    fireEvent.change(amountInput, { target: { value: "25000" } });

    // Select the source account
    fireEvent.click(screen.getByRole("button", { name: /\+ Add/i }));

    // Submit via the form element
    fireEvent.submit(document.getElementById("roth-conversion-form")!);

    await waitFor(() => expect(onSubmitDraft).toHaveBeenCalledTimes(1));

    const technique = onSubmitDraft.mock.calls[0][0];
    expect(technique.conversionType).toBe("fixed_amount");
    expect(technique.fixedAmount).toBe(25000);
    expect(typeof technique.id).toBe("string");
    expect(technique.id.length).toBeGreaterThan(0);

    // fetch must NOT have been called for persistence
    expect(fetchMock).not.toHaveBeenCalled();

    // onSaved must have been called to close the dialog
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});

describe("AddRothConversionForm — inline Roth IRA creation", () => {
  const NO_ROTH = [
    { id: "trad-client", name: "Client Trad IRA", category: "retirement", subType: "traditional_ira", ownerFamilyMemberId: "fm-client" },
    { id: "trad-spouse", name: "Spouse Trad IRA", category: "retirement", subType: "traditional_ira", ownerFamilyMemberId: "fm-spouse" },
  ];
  // MC asset mixes: the chosen model portfolio's, and the retirement category
  // default's. onCreate must report the mix matching the selected growth source.
  const MP1_MIX = [
    { assetClassId: "ac-eq", weight: 0.7 },
    { assetClassId: "ac-bond", weight: 0.3 },
  ];
  const RET_DEFAULT_MIX = [
    { assetClassId: "ac-eq", weight: 0.6 },
    { assetClassId: "ac-bond", weight: 0.4 },
  ];
  const creation = (onCreate = vi.fn()) => ({
    owners: [
      { familyMemberId: "fm-client", label: "John" },
      { familyMemberId: "fm-spouse", label: "Jane" },
    ],
    modelPortfolios: [{ id: "mp-1", name: "Growth 70/30", growthRate: 0.065, mix: MP1_MIX }],
    retirementGrowthDefault: 0.06,
    retirementDefaultMix: RET_DEFAULT_MIX,
    resolvedInflationRate: 0.025,
    onCreate,
  });
  const panel = () => screen.getByRole("group", { name: /new roth ira account/i });
  const growthSelect = () =>
    within(panel())
      .getAllByRole("combobox")
      .find((s) => within(s).queryByText("Custom %"))!;

  it("replaces the dead-end warning with an Owner + Growth creation panel", () => {
    render(
      <AddRothConversionForm
        clientId="client-123"
        accounts={NO_ROTH}
        onClose={() => {}}
        onSaved={vi.fn()}
        onSubmitDraft={vi.fn()}
        rothAccountCreation={creation()}
      />,
    );
    expect(screen.queryByText(/No Roth account on this plan yet/i)).not.toBeInTheDocument();
    expect(within(panel()).getByLabelText(/Roth IRA owner/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Roth IRA" })).toBeInTheDocument();
  });

  it("creates a roth_ira account named 'Roth IRA - {owner}' at the plan default growth and auto-selects it", () => {
    const onCreate = vi.fn();
    render(
      <AddRothConversionForm
        clientId="client-123"
        accounts={NO_ROTH}
        onClose={() => {}}
        onSaved={vi.fn()}
        onSubmitDraft={vi.fn()}
        rothAccountCreation={creation(onCreate)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create Roth IRA" }));

    expect(onCreate).toHaveBeenCalledTimes(1);
    const acct = onCreate.mock.calls[0][0];
    expect(acct.subType).toBe("roth_ira");
    expect(acct.category).toBe("retirement");
    expect(acct.name).toBe("Roth IRA - John");
    expect(acct.value).toBe(0);
    expect(acct.growthRate).toBeCloseTo(0.06);
    // "Plan default" growth reports the retirement default's mix so the draft
    // Roth's converted dollars are randomized in Monte Carlo.
    expect(onCreate.mock.calls[0][1]).toEqual(RET_DEFAULT_MIX);
    expect(acct.owners).toEqual([{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }]);

    // Destination now offers + selects the new account; submit is enabled.
    const dest = screen.getByLabelText(/Destination Account/i) as HTMLSelectElement;
    expect(dest.value).toBe(acct.id);
    expect(within(dest).getByText("Roth IRA - John")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Conversion" })).not.toBeDisabled();
  });

  it("resolves the selected owner and a model-portfolio growth rate", () => {
    const onCreate = vi.fn();
    render(
      <AddRothConversionForm
        clientId="client-123"
        accounts={NO_ROTH}
        onClose={() => {}}
        onSaved={vi.fn()}
        onSubmitDraft={vi.fn()}
        rothAccountCreation={creation(onCreate)}
      />,
    );
    fireEvent.change(within(panel()).getByLabelText(/Roth IRA owner/i), { target: { value: "fm-spouse" } });
    fireEvent.change(growthSelect(), { target: { value: "mp:mp-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Roth IRA" }));

    const acct = onCreate.mock.calls[0][0];
    expect(acct.name).toBe("Roth IRA - Jane");
    expect(acct.owners[0].familyMemberId).toBe("fm-spouse");
    expect(acct.growthRate).toBeCloseTo(0.065);
    // The chosen model portfolio's mix rides along with the account.
    expect(onCreate.mock.calls[0][1]).toEqual(MP1_MIX);
  });

  it("resolves a custom growth percent to a decimal", () => {
    const onCreate = vi.fn();
    render(
      <AddRothConversionForm
        clientId="client-123"
        accounts={NO_ROTH}
        onClose={() => {}}
        onSaved={vi.fn()}
        onSubmitDraft={vi.fn()}
        rothAccountCreation={creation(onCreate)}
      />,
    );
    fireEvent.change(growthSelect(), { target: { value: "custom" } });
    fireEvent.change(within(panel()).getByRole("textbox"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Roth IRA" }));

    expect(onCreate.mock.calls[0][0].growthRate).toBeCloseTo(0.08);
    // Custom growth is deterministic — no mix, so MC uses the fixed rate.
    expect(onCreate.mock.calls[0][1]).toEqual([]);
  });

  it("restricts conversion sources to the new Roth's owner", () => {
    render(
      <AddRothConversionForm
        clientId="client-123"
        accounts={NO_ROTH}
        onClose={() => {}}
        onSaved={vi.fn()}
        onSubmitDraft={vi.fn()}
        rothAccountCreation={creation()}
      />,
    );
    // Owner defaults to the first (John / fm-client).
    fireEvent.click(screen.getByRole("button", { name: "Create Roth IRA" }));
    expect(screen.getByText("Client Trad IRA")).toBeInTheDocument();
    expect(screen.queryByText("Spouse Trad IRA")).not.toBeInTheDocument();
  });
});
