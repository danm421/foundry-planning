// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InsuranceStep } from "../insurance-step";
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
  familyMemberIds: { client: "fam-client", spouse: null },
} as unknown as QsBootstrap;

describe("InsuranceStep", () => {
  let saveFn: () => Promise<void>;
  let fetchMock: ReturnType<typeof mockFetch>;

  beforeEach(() => {
    fetchMock = mockFetch();
    saveFn = async () => {};
  });

  function renderStep() {
    render(
      <InsuranceStep
        ctx={ctx}
        bootstrap={bootstrap}
        busy={false}
        registerSave={(fn) => {
          saveFn = fn;
        }}
      />,
    );
  }

  it("adds a 20-year term policy", async () => {
    renderStep();
    fireEvent.click(screen.getByRole("button", { name: /add policy/i }));
    fireEvent.change(screen.getByLabelText("Face value"), { target: { value: "1000000" } });
    fireEvent.change(screen.getByLabelText("Annual premium"), { target: { value: "1200" } });
    fireEvent.change(screen.getByLabelText("Term length"), { target: { value: "20" } });
    await saveFn();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(findCall((u) => u.endsWith("/insurance-policies"))[1].body);
    expect(body).toMatchObject({
      policyType: "term",
      insuredPerson: "client",
      faceValue: 1000000,
      termIssueYear: 2026,
      termLengthYears: 20,
      ownerRef: { kind: "family", id: "fam-client" },
    });
  });

  it("throws a validation error for term policy without term length or endsAtInsuredRetirement", async () => {
    renderStep();
    fireEvent.click(screen.getByRole("button", { name: /add policy/i }));
    fireEvent.change(screen.getByLabelText("Face value"), { target: { value: "500000" } });
    // No term length set, no endsAtInsuredRetirement checked
    await expect(saveFn()).rejects.toThrow(
      "Term policies need a term length or 'ends at retirement'.",
    );
  });
});
