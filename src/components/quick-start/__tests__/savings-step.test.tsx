// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SavingsStep } from "../savings-step";
import { buildQsContext } from "@/lib/quick-start/derive";
import type { QsBootstrap } from "@/lib/quick-start/bootstrap";
import { mockFetch, findCall } from "./fetch-mock";

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
const createdAccounts = [
  { id: "acct-401k", category: "retirement", subType: "401k", name: "Alice - 401(k)" },
];

describe("SavingsStep", () => {
  let saveFn: () => Promise<void>;
  let fetchMock: ReturnType<typeof mockFetch>;
  beforeEach(() => {
    fetchMock = mockFetch();
    saveFn = async () => {};
  });

  function renderStep() {
    render(
      <SavingsStep
        ctx={ctx}
        bootstrap={bootstrap}
        busy={false}
        registerSave={(fn) => {
          saveFn = fn;
        }}
        createdAccounts={createdAccounts}
      />,
    );
  }

  it("posts a 401k percent contribution with employer match", async () => {
    renderStep();

    // Enable the 401k account row
    fireEvent.click(screen.getByLabelText("Enable savings Alice - 401(k)"));

    // Set contribution mode to "percent"
    fireEvent.change(screen.getByLabelText("Contribution mode"), {
      target: { value: "percent" },
    });

    // Set percent of salary to 10 (display value; stored as 0.1)
    fireEvent.change(screen.getByLabelText("Percent of salary"), {
      target: { value: "10" },
    });

    // Set employer match to "percent"
    fireEvent.change(screen.getByLabelText("Employer match"), {
      target: { value: "percent" },
    });

    // Set match percent to 50 (stored as 0.5)
    fireEvent.change(screen.getByLabelText("Match percent"), {
      target: { value: "50" },
    });

    // Set match cap to 6 (stored as 0.06)
    fireEvent.change(screen.getByLabelText("Match cap"), {
      target: { value: "6" },
    });

    await saveFn();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const body = JSON.parse(findCall((u) => u.endsWith("/savings-rules"))[1].body);
    expect(body).toMatchObject({
      accountId: "acct-401k",
      annualPercent: 0.1,
      employerMatchPct: 0.5,
      employerMatchCap: 0.06,
      isDeductible: true,
    });
  });

  it("shows an empty-state hint when no eligible accounts", async () => {
    render(
      <SavingsStep
        ctx={ctx}
        bootstrap={bootstrap}
        busy={false}
        registerSave={(fn) => {
          saveFn = fn;
        }}
        createdAccounts={[]}
      />,
    );
    expect(screen.getByText(/no eligible accounts/i)).toBeTruthy();
    // save is a no-op (should not throw)
    await saveFn();
  });

  it("does not POST for disabled rows", async () => {
    renderStep();
    // Do NOT enable any row; just call save
    await saveFn();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
