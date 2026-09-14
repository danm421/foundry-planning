// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import SellToTrustDialog, {
  type SaleToTrustInput,
} from "../sell-to-trust-dialog";
import type { Entity } from "@/components/family-view";
import type { AssetsTabAccount } from "../assets-tab";

const TRUST = {
  id: "trust-1",
  name: "Mueller IDGT",
  entityType: "trust",
  notes: null,
  includeInPortfolio: true,
  isGrantor: true,
  value: "0",
  basis: "0",
  owners: [],
  owner: null,
  grantor: "client",
  beneficiaries: null,
  trustSubType: "idgt",
  isIrrevocable: true,
  trustee: null,
  trustEnds: null,
  distributionMode: null,
  distributionAmount: null,
  distributionPercent: null,
} as unknown as Entity;

const ACCOUNTS: AssetsTabAccount[] = [
  {
    id: "acct-1",
    name: "Joint Brokerage",
    value: 1_000_000,
    owners: [{ kind: "family_member", familyMemberId: "fm-1", percent: 1 }],
  },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  global.fetch = fetchMock as unknown as typeof fetch;
});

function renderDialog(
  over: Partial<React.ComponentProps<typeof SellToTrustDialog>> = {},
) {
  render(
    <SellToTrustDialog
      clientId="client-1"
      scenarioId="scen-1"
      trust={TRUST}
      accounts={ACCOUNTS}
      {...over}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Sell an asset to the trust" }),
  );
  // Positive render assertion: the dialog really opened, so a later
  // "nothing happened" assertion can't pass on an unmounted form.
  expect(screen.getByRole("dialog")).toBeInTheDocument();
}

/** The footer's primary button — distinct from the "Sell an asset…" opener. */
const sellButton = () =>
  screen.getByRole("button", { name: "Sell to trust" }) as HTMLButtonElement;

function fillTerms() {
  fireEvent.change(screen.getByLabelText("Asset to sell"), {
    target: { value: "acct-1" },
  });
}

describe("SellToTrustDialog", () => {
  it("POSTs the sale to the scenario's sale-to-trust route by default", async () => {
    renderDialog();
    fillTerms();
    fireEvent.click(sellButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/clients/client-1/scenarios/scen-1/sale-to-trust");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      accountId: "acct-1",
      trustEntityId: "trust-1",
      noteInterestRate: 0.04,
      noteTermMonths: 120,
      noteStartYear: new Date().getFullYear(),
      notePaymentType: "interest_only_balloon",
    });
  });

  it("calls an injected submit with the sale terms and never touches the network", async () => {
    const submit = vi.fn<(input: SaleToTrustInput) => Promise<void>>(
      async () => {},
    );
    renderDialog({ submit });
    fillTerms();
    fireEvent.click(sellButton());

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][0]).toEqual({
      accountId: "acct-1",
      trustEntityId: "trust-1",
      noteInterestRate: 0.04,
      noteTermMonths: 120,
      noteStartYear: new Date().getFullYear(),
      notePaymentType: "interest_only_balloon",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still refuses a sale with no scenario and no injected submit", async () => {
    renderDialog({ scenarioId: null });
    fillTerms();
    expect(sellButton().disabled).toBe(true);

    // Drive the form directly — the disabled button can't, and the guard is
    // what has to keep speaking.
    fireEvent.submit(document.getElementById("sell-to-trust-form")!);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Sales to trust require an active scenario. Open this trust from a scenario view.",
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an injected submit satisfies the active-scenario requirement", async () => {
    const submit = vi.fn<(input: SaleToTrustInput) => Promise<void>>(
      async () => {},
    );
    renderDialog({ scenarioId: null, submit });
    fillTerms();
    expect(sellButton().disabled).toBe(false);
    fireEvent.click(sellButton());

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a rejected injected submit on the dialog's error line", async () => {
    const submit = vi
      .fn<(input: SaleToTrustInput) => Promise<void>>()
      .mockRejectedValue(new Error("no room left in the working tree"));
    renderDialog({ submit });
    fillTerms();
    fireEvent.click(sellButton());

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "no room left in the working tree",
      ),
    );
  });
});
