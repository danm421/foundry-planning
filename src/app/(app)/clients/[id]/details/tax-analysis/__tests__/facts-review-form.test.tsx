// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FactsReviewForm } from "../facts-review-form";
import { emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { retireeMfj, highEarnerMfj } from "@/lib/tax-analysis/__tests__/fixtures";
import type { YearDetail } from "../tax-analysis-content";

// Filing status and residence state used to render as read-only text
// (`facts-review-form.tsx` lines 128-133 pre-fix). Because
// `emptyTaxReturnFacts()` (the manual-entry path) sets `filingStatus: null`,
// and `buildBracketMap()` returns null whenever filingStatus is null, a
// manually-entered return — or any upload where extraction missed filing
// status — silently lost the entire bracket-map hero + bracket-based
// observations. These tests cover the fix: filing status and residence
// state are now editable and flow into the PUT body.

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function manualEntryDetail(): YearDetail {
  return {
    taxYear: 2025,
    status: "needs_review",
    facts: emptyTaxReturnFacts(2025),
    extractedFacts: null,
    warnings: [],
    analysis: null,
  };
}

function putRequestBody(): { facts: Record<string, unknown>; markReady: boolean } {
  const call = fetchMock.mock.calls.find((c) => c[1]?.method === "PUT");
  if (!call) throw new Error("no PUT call recorded");
  return JSON.parse(call[1].body as string);
}

describe("FactsReviewForm — filing status + residence state (editable)", () => {
  it("(a) renders the filing-status select at the placeholder for a manual-entry facts shape (filingStatus: null)", () => {
    render(<FactsReviewForm clientId="c1" detail={manualEntryDetail()} onSaved={vi.fn()} />);

    const select = screen.getByLabelText(/filing status/i) as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(screen.getByRole("option", { name: /select filing status/i })).toBeTruthy();
  });

  it("(b) selecting a filing status then saving PUTs facts.filingStatus as the chosen snake_case value", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({}));
    const user = userEvent.setup();
    render(<FactsReviewForm clientId="c1" detail={manualEntryDetail()} onSaved={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText(/filing status/i), "married_joint");
    await user.click(screen.getByRole("button", { name: /looks right/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/clients/c1/tax-returns/2025",
      expect.objectContaining({ method: "PUT" }),
    );
    const body = putRequestBody();
    expect(body.facts.filingStatus).toBe("married_joint");
  });

  it("(c) editing residence state via StateSelect flows into the PUT body's facts.residenceState", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({}));
    const user = userEvent.setup();
    render(<FactsReviewForm clientId="c1" detail={manualEntryDetail()} onSaved={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText(/residence state/i), "CA");
    await user.click(screen.getByRole("button", { name: /save draft/i }));

    const body = putRequestBody();
    expect(body.facts.residenceState).toBe("CA");
  });

  it("seeds the selects from an already-populated fixture and round-trips both fields unchanged on save", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({}));
    const user = userEvent.setup();
    const detail: YearDetail = {
      taxYear: 2025,
      status: "ready",
      facts: retireeMfj(),
      extractedFacts: retireeMfj(),
      warnings: [],
      analysis: null,
    };
    render(<FactsReviewForm clientId="c1" detail={detail} onSaved={vi.fn()} />);

    expect((screen.getByLabelText(/filing status/i) as HTMLSelectElement).value).toBe(
      "married_joint",
    );
    expect((screen.getByLabelText(/residence state/i) as HTMLSelectElement).value).toBe("PA");

    await user.click(screen.getByRole("button", { name: /save draft/i }));

    const body = putRequestBody();
    expect(body.facts.filingStatus).toBe("married_joint");
    expect(body.facts.residenceState).toBe("PA");
  });

  it("clearing filing status back to the placeholder nulls it out in the PUT body", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({}));
    const user = userEvent.setup();
    const detail: YearDetail = {
      taxYear: 2025,
      status: "ready",
      facts: retireeMfj(),
      extractedFacts: retireeMfj(),
      warnings: [],
      analysis: null,
    };
    render(<FactsReviewForm clientId="c1" detail={detail} onSaved={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText(/filing status/i), "");
    await user.click(screen.getByRole("button", { name: /save draft/i }));

    const body = putRequestBody();
    expect(body.facts.filingStatus).toBeNull();
  });
});

function retireeDetail(): YearDetail {
  return {
    taxYear: 2025,
    status: "needs_review",
    facts: retireeMfj(),
    extractedFacts: retireeMfj(),
    warnings: [],
    analysis: null,
  };
}

describe("FactsReviewForm — formatted money + surfaced scalar fields", () => {
  it("renders extracted money formatted when blurred (taxable interest → $8,000)", () => {
    render(<FactsReviewForm clientId="c1" detail={retireeDetail()} onSaved={vi.fn()} />);
    const input = screen.getByLabelText(/taxable interest/i) as HTMLInputElement;
    expect(input.value).toBe("$8,000");
    expect(input.type).toBe("text");
  });

  it("editing Unemployment (surfaced field) flows into the PUT body as a number", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({}));
    const user = userEvent.setup();
    render(<FactsReviewForm clientId="c1" detail={manualEntryDetail()} onSaved={vi.fn()} />);
    const input = screen.getByLabelText(/unemployment/i);
    await user.click(input);
    await user.type(input, "12,000");
    await user.click(screen.getByRole("button", { name: /save draft/i }));
    const body = putRequestBody();
    expect((body.facts.income as Record<string, unknown>).unemployment).toBe(12000);
  });

  it("renders the other surfaced fields", () => {
    render(<FactsReviewForm clientId="c1" detail={manualEntryDetail()} onSaved={vi.fn()} />);
    for (const label of [
      /other income/i, /total income/i, /foreign tax credit/i, /energy credits/i,
      /excess aptc repayment/i, /other credits/i, /other taxes/i, /other payments/i,
    ]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
  });

  it("dependents counts render in the top card and round-trip on save", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({}));
    const user = userEvent.setup();
    render(<FactsReviewForm clientId="c1" detail={manualEntryDetail()} onSaved={vi.fn()} />);
    await user.type(screen.getByLabelText(/dependents under 17/i), "2");
    await user.type(screen.getByLabelText(/dependents 17–23/i), "1");
    await user.click(screen.getByRole("button", { name: /save draft/i }));
    const body = putRequestBody();
    expect(body.facts.dependentsUnder17).toBe(2);
    expect(body.facts.dependents17to23).toBe(1);
  });
});

function highEarnerDetail(): YearDetail {
  return {
    taxYear: 2025,
    status: "needs_review",
    facts: highEarnerMfj(),
    extractedFacts: highEarnerMfj(),
    warnings: [],
    analysis: null,
  };
}

describe("FactsReviewForm — deduction taken + Schedule A", () => {
  it("renders the deduction-taken select seeded from the fixture", () => {
    render(<FactsReviewForm clientId="c1" detail={highEarnerDetail()} onSaved={vi.fn()} />);
    expect((screen.getByLabelText(/deduction taken/i) as HTMLSelectElement).value).toBe("itemized");
  });

  it("shows editable, formatted Schedule A fields when scheduleA was extracted", () => {
    render(<FactsReviewForm clientId="c1" detail={highEarnerDetail()} onSaved={vi.fn()} />);
    expect((screen.getByLabelText(/salt paid/i) as HTMLInputElement).value).toBe("$32,000");
    expect((screen.getByLabelText(/mortgage interest/i) as HTMLInputElement).value).toBe("$22,000");
  });

  it("hides Schedule A entirely for a standard-deduction return", () => {
    render(<FactsReviewForm clientId="c1" detail={retireeDetail()} onSaved={vi.fn()} />);
    expect(screen.queryByLabelText(/salt paid/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /add schedule a/i })).toBeNull();
  });

  it("itemized with no Schedule A offers the add button; clicking reveals fields that flow to PUT", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({}));
    const user = userEvent.setup();
    render(<FactsReviewForm clientId="c1" detail={manualEntryDetail()} onSaved={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText(/deduction taken/i), "itemized");
    await user.click(screen.getByRole("button", { name: /add schedule a breakdown/i }));

    const salt = screen.getByLabelText(/salt paid/i);
    await user.click(salt);
    await user.type(salt, "9,000");
    await user.click(screen.getByRole("button", { name: /save draft/i }));

    const body = putRequestBody();
    const deductions = body.facts.deductions as Record<string, unknown>;
    expect(deductions.deductionTaken).toBe("itemized");
    expect((deductions.scheduleA as Record<string, unknown>).saltPaid).toBe(9000);
  });

  it("edited Schedule A values round-trip alongside untouched siblings", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({}));
    const user = userEvent.setup();
    render(<FactsReviewForm clientId="c1" detail={highEarnerDetail()} onSaved={vi.fn()} />);

    const cash = screen.getByLabelText(/charitable — cash/i);
    await user.click(cash);
    await user.clear(cash);
    await user.type(cash, "5000");
    await user.click(screen.getByRole("button", { name: /save draft/i }));

    const scheduleA = (putRequestBody().facts.deductions as { scheduleA: Record<string, unknown> }).scheduleA;
    expect(scheduleA.charitableCash).toBe(5000);
    expect(scheduleA.saltPaid).toBe(32000); // untouched sibling preserved
  });
});
