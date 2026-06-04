// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ExpensesStep } from "../expenses-step";
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
  expenseStubs: { currentId: "cur-1", retirementId: "ret-1" },
} as unknown as QsBootstrap;

describe("ExpensesStep", () => {
  let saveFn: () => Promise<void>;
  let fetchMock: ReturnType<typeof mockFetch>;

  beforeEach(() => {
    fetchMock = mockFetch();
    saveFn = async () => {};
  });

  function renderStep() {
    render(
      <ExpensesStep
        ctx={ctx}
        bootstrap={bootstrap}
        busy={false}
        registerSave={(fn) => {
          saveFn = fn;
        }}
      />,
    );
  }

  it("PUTs both expense stubs", async () => {
    renderStep();
    fireEvent.change(screen.getByLabelText("Current annual expenses"), {
      target: { value: "80000" },
    });
    fireEvent.change(screen.getByLabelText("Retirement annual expenses"), {
      target: { value: "60000" },
    });
    await saveFn();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const currentCall = findCall((u) => u.includes("/expenses/cur-1"));
    expect(currentCall[1].method).toBe("PUT");
    expect(JSON.parse(currentCall[1].body)).toMatchObject({ annualAmount: 80000 });

    const retirementCall = findCall((u) => u.includes("/expenses/ret-1"));
    expect(retirementCall[1].method).toBe("PUT");
    expect(JSON.parse(retirementCall[1].body)).toMatchObject({ annualAmount: 60000 });
  });

  it("computes liability payment", async () => {
    renderStep();
    // Fill required fields first so the gate passes
    fireEvent.change(screen.getByLabelText("Current annual expenses"), {
      target: { value: "80000" },
    });
    fireEvent.change(screen.getByLabelText("Retirement annual expenses"), {
      target: { value: "60000" },
    });

    // Add a liability
    fireEvent.click(screen.getByRole("button", { name: /add liability/i }));
    fireEvent.change(screen.getByLabelText("Liability name"), {
      target: { value: "Mortgage" },
    });
    fireEvent.change(screen.getByLabelText("Balance"), { target: { value: "300000" } });
    fireEvent.change(screen.getByLabelText("Interest rate"), { target: { value: "6" } });
    fireEvent.change(screen.getByLabelText("Term (years)"), { target: { value: "30" } });

    await saveFn();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const liabilityCall = findCall((u) => u.endsWith("/liabilities"));
    const body = JSON.parse(liabilityCall[1].body);
    expect(body.termMonths).toBe(360);
    expect(Math.round(Number(body.monthlyPayment))).toBe(1799);
  });
});
