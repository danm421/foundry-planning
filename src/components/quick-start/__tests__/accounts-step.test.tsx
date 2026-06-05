// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AccountsStep } from "../accounts-step";
import { useLiftedList } from "@/lib/quick-start/use-lifted-list";
import type { AccountRow } from "@/lib/quick-start/account-save";
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

function Mount({
  onRegisterSave,
}: {
  onRegisterSave?: (fn: () => Promise<void>) => void;
}) {
  const list = useLiftedList<AccountRow>();
  return (
    <AccountsStep
      ctx={ctx}
      bootstrap={bootstrap}
      busy={false}
      registerSave={(fn) => {
        onRegisterSave?.(fn);
      }}
      setCreatedAccounts={vi.fn()}
      list={list}
    />
  );
}

describe("AccountsStep", () => {
  let saveFn: () => Promise<void>;
  beforeEach(() => {
    mockFetch();
    saveFn = async () => {};
  });

  function renderStep() {
    render(<Mount onRegisterSave={(fn) => { saveFn = fn; }} />);
  }

  it("adds a cash and a 401k account", async () => {
    renderStep();

    // Add account 1 — it auto-opens (cash by default)
    fireEvent.click(screen.getByRole("button", { name: /add account/i }));
    // Row 1 is open; set its value
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "50000" } });
    // Close row 1 by clicking Done
    fireEvent.click(screen.getByRole("button", { name: /done/i }));

    // Add account 2 — it auto-opens
    fireEvent.click(screen.getByRole("button", { name: /add account/i }));
    // Change type to retirement
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "retirement" } });
    // Change subtype to 401k
    fireEvent.change(screen.getByLabelText("Account type"), { target: { value: "401k" } });
    // Set value
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "250000" } });

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
