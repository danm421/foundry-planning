// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InsuranceStep } from "../insurance-step";
import { useLiftedList } from "@/lib/quick-start/use-lifted-list";
import type { InsuranceRow } from "@/lib/quick-start/insurance-save";
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

function Mount({
  onRegisterSave,
}: {
  onRegisterSave?: (fn: () => Promise<void>) => void;
}) {
  const list = useLiftedList<InsuranceRow>();
  return (
    <InsuranceStep
      ctx={ctx}
      bootstrap={bootstrap}
      busy={false}
      registerSave={(fn) => {
        onRegisterSave?.(fn);
      }}
      list={list}
    />
  );
}

describe("InsuranceStep", () => {
  let saveFn: () => Promise<void>;

  beforeEach(() => {
    mockFetch();
    saveFn = async () => {};
  });

  function renderStep() {
    render(<Mount onRegisterSave={(fn) => { saveFn = fn; }} />);
  }

  it("adds a 20-year term policy", async () => {
    renderStep();
    // Click "+ Add policy" — row auto-opens
    fireEvent.click(screen.getByRole("button", { name: /add policy/i }));
    // Set face value, premium, and term length
    fireEvent.change(screen.getByLabelText("Face value"), { target: { value: "1000000" } });
    fireEvent.change(screen.getByLabelText("Annual premium"), { target: { value: "1200" } });
    fireEvent.change(screen.getByLabelText("Term length"), { target: { value: "20" } });

    await saveFn();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

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

  it("throws validation error for term w/o term length", async () => {
    renderStep();
    fireEvent.click(screen.getByRole("button", { name: /add policy/i }));
    // Set face value to make the row non-empty, but leave term length blank
    fireEvent.change(screen.getByLabelText("Face value"), { target: { value: "500000" } });

    await expect(saveFn()).rejects.toThrow(
      "Term policies need a term length or 'ends at retirement'.",
    );
  });
});
