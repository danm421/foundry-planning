// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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
