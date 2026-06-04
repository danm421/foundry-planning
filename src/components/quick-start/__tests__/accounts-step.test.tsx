// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AccountsStep } from "../accounts-step";
import { buildQsContext } from "@/lib/quick-start/derive";
import type { QsBootstrap } from "@/lib/quick-start/bootstrap";
import { mockFetch, fetchCalls } from "./fetch-mock";

const ctx = buildQsContext({
  client: {
    dateOfBirth: "1965-04-15",
    retirementAge: 65,
    planEndAge: 95,
    spouseDob: null,
    spouseRetirementAge: null,
  },
  planStartYear: 2026,
  planEndYear: 2060,
  clientFirstName: "Alice",
  spouseFirstName: null,
  hasSpouse: false,
});
const bootstrap = { clientId: "c1" } as unknown as QsBootstrap;

describe("AccountsStep", () => {
  let saveFn: () => Promise<void>;
  beforeEach(() => {
    mockFetch();
    saveFn = async () => {};
  });

  function renderStep() {
    render(
      <AccountsStep
        ctx={ctx}
        bootstrap={bootstrap}
        busy={false}
        registerSave={(fn) => {
          saveFn = fn;
        }}
        setCreatedAccounts={vi.fn()}
      />,
    );
  }

  it("adds a cash and a 401k account", async () => {
    renderStep();

    // Add account 1 (cash by default)
    fireEvent.click(screen.getByRole("button", { name: /add account/i }));
    // Set value for first account
    const valueInputs1 = screen.getAllByLabelText("Value");
    fireEvent.change(valueInputs1[0], { target: { value: "50000" } });

    // Add account 2
    fireEvent.click(screen.getByRole("button", { name: /add account/i }));
    // Change type of second account to retirement
    const typeSelects = screen.getAllByLabelText("Type");
    fireEvent.change(typeSelects[1], { target: { value: "retirement" } });
    // Change subtype to 401k
    const subtypeSelect = screen.getByLabelText("Account type");
    fireEvent.change(subtypeSelect, { target: { value: "401k" } });
    // Set value for second account
    const valueInputs2 = screen.getAllByLabelText("Value");
    fireEvent.change(valueInputs2[1], { target: { value: "250000" } });

    await saveFn();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    const accountCalls = fetchCalls()
      .filter((c) => String(c[0]).endsWith("/accounts"))
      .map((c) => JSON.parse(c[1].body));

    expect(accountCalls).toHaveLength(2);
    expect(accountCalls).toContainEqual(
      expect.objectContaining({ category: "cash", value: 50000, basis: 50000 }),
    );
    expect(accountCalls).toContainEqual(
      expect.objectContaining({ category: "retirement", subType: "401k", value: 250000, basis: 0 }),
    );
  });
});
