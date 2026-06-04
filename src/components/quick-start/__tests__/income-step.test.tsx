// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { IncomeStep } from "../income-step";
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
const bootstrap = {
  clientId: "c1",
  ssStubs: { client: "ss-stub-1", spouse: null },
} as unknown as QsBootstrap;

describe("IncomeStep", () => {
  let saveFn: () => Promise<void>;
  let fetchMock: ReturnType<typeof mockFetch>;
  beforeEach(() => {
    fetchMock = mockFetch();
    saveFn = async () => {};
  });
  function renderStep() {
    render(
      <IncomeStep
        ctx={ctx}
        bootstrap={bootstrap}
        busy={false}
        registerSave={(fn) => {
          saveFn = fn;
        }}
      />,
    );
  }

  it("adds a salary and POSTs the derived payload", async () => {
    renderStep();
    fireEvent.click(screen.getByRole("button", { name: /add income/i }));
    // choose salary kind (default), enter amount
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "200000" } });
    await saveFn();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const call = findCall((u) => u.endsWith("/incomes"));
    const body = JSON.parse(call[1].body);
    expect(body).toMatchObject({
      type: "salary",
      name: "Alice - Salary",
      taxType: "earned_income",
      annualAmount: 200000,
      endYearRef: "client_retirement",
    });
  });

  it("PATCHes the SS stub instead of creating a new SS income", async () => {
    renderStep();
    fireEvent.click(screen.getByRole("button", { name: /add income/i }));
    fireEvent.change(screen.getByLabelText(/type/i), { target: { value: "social_security" } });
    fireEvent.change(screen.getByLabelText(/monthly benefit/i), { target: { value: "3000" } });
    await saveFn();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const call = findCall((u) => u.includes("/incomes/ss-stub-1"));
    expect(call[1].method).toBe("PUT");
    expect(JSON.parse(call[1].body)).toMatchObject({ ssBenefitMode: "pia_at_fra", piaMonthly: 3000 });
  });
});
