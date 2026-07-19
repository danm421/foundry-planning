// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import DivorceWorkbench from "../divorce-workbench";
import type { WorkbenchPayload } from "@/lib/divorce/divorce-plans";
import type { DivisibleObject } from "@/lib/divorce/allocation-rules";

const salary: DivisibleObject = {
  kind: "income",
  id: "11111111-1111-1111-1111-111111111111",
  label: "Salary",
  subtype: null,
  value: 0,
  basis: 0,
  rothValue: 0,
  annualAmount: 120000,
  ownerSide: "primary",
  entityOwnedById: null,
  childIds: [],
};

function makePayload(overrides: Partial<WorkbenchPayload> = {}): WorkbenchPayload {
  const plan = {
    splitYear: 2026,
    primaryFilingStatus: "single",
    spouseFilingStatus: "single",
    spouseState: "NY",
  } as unknown as WorkbenchPayload["plan"];
  return {
    plan,
    objects: [salary],
    allocations: [],
    resolved: [],
    totals: {
      primary: { netWorth: 0, annualIncome: 0, annualExpenses: 0 },
      spouse: { netWorth: 0, annualIncome: 0, annualExpenses: 0 },
    },
    people: { primaryName: "Alex Kim", spouseName: "Jordan Kim" },
    ...overrides,
  };
}

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe("DivorceWorkbench", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(makePayload()));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("derives per-side totals locally (income follows the primary owner)", () => {
    render(<DivorceWorkbench payload={makePayload()} clientId="c1" />);
    // Both people surface as the board's side columns.
    const primary = within(screen.getByRole("region", { name: "Alex Kim" }));
    expect(screen.getByRole("region", { name: "Jordan Kim" })).toBeTruthy();
    // The primary's $120k salary card lands on Alex's side (income defaults to
    // its owner — no allocation row needed).
    expect(primary.getByText("$120,000")).toBeTruthy();
  });

  it("coalesces rapid settings edits into a single debounced PATCH", async () => {
    vi.useFakeTimers();
    render(<DivorceWorkbench payload={makePayload()} clientId="c1" />);

    // The label also wraps the FieldTooltip's help button, so scope to <input>.
    const year = screen.getByLabelText(/split year/i, {
      selector: "input",
    }) as HTMLInputElement;
    const primaryFiling = screen.getByRole("combobox", {
      name: /Alex Kim/i,
    }) as HTMLSelectElement;

    fireEvent.change(year, { target: { value: "2030" } });
    fireEvent.change(primaryFiling, { target: { value: "head_of_household" } });

    // Optimistic: the controlled select reflects the choice immediately.
    expect(primaryFiling.value).toBe("head_of_household");
    // Nothing has flushed yet — still inside the 400ms debounce window.
    expect(global.fetch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(400);

    // Exactly one PATCH, carrying BOTH edits merged into one body.
    const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const patchCalls = calls.filter(([, init]) => (init as RequestInit)?.method === "PATCH");
    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0][0]).toBe("/api/clients/c1/divorce-plan");
    const body = JSON.parse((patchCalls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ splitYear: 2030, primaryFilingStatus: "head_of_household" });
  });

  it("renders the verbatim one-way-door banner", () => {
    render(<DivorceWorkbench payload={makePayload()} clientId="c1" />);
    expect(
      screen.getByText(
        "Nothing changes until you commit. Committing creates a separate household and cannot be undone.",
      ),
    ).toBeTruthy();
  });
});
