// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { DebtPaydownWorkspace } from "@/components/portal/debt-paydown-workspace";
import { comparePaydown } from "@/lib/calculators/debt-paydown";
import { DEFAULT_DEBT_PAYDOWN_STATE } from "@/lib/calculators/debt-paydown-state";
import { fmtUsd } from "@/lib/portal/format";
import type { DebtPaydownDTO } from "@/lib/portal/load-debt-paydown";

// The chart needs a canvas; the numbers are what this test is about.
vi.mock("@/components/portal/debt-paydown-chart", () => ({
  DebtPaydownChart: () => <div data-testid="paydown-chart" />,
}));

// `solveExtraForTarget` is left wired to the REAL implementation by default
// (delegated in the factory below) so every ordinary test exercises real
// goal-seek maths. Only the "unreachable" test below overrides it — building
// a real debt whose full balance genuinely can't clear it inside the
// simulator's own horizon isn't representable through realistic loan
// numbers, and the render branch, not the maths, is what that test is about.
// `comparePaydown` itself is left untouched by the mock (spread from
// `actual`), so importing it directly below gives the test its own oracle
// for the real simulator's output.
const { solveExtraForTargetMock } = vi.hoisted(() => ({ solveExtraForTargetMock: vi.fn() }));
vi.mock("@/lib/calculators/debt-paydown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/calculators/debt-paydown")>();
  solveExtraForTargetMock.mockImplementation(actual.solveExtraForTarget);
  return { ...actual, solveExtraForTarget: solveExtraForTargetMock };
});

const USABLE = {
  id: "l1",
  name: "Auto loan",
  balance: 18_400,
  annualRate: 0.059,
  minimumPayment: 415,
  liabilityType: "auto",
  rateFromApr: false,
};

const NEEDS_RATE = {
  id: "l2",
  name: "Store card",
  balance: 1_150,
  annualRate: null,
  minimumPayment: null,
  liabilityType: "credit_card",
  rateFromApr: false,
};

function dto(over: Partial<DebtPaydownDTO> = {}): DebtPaydownDTO {
  return { debts: [USABLE], state: DEFAULT_DEBT_PAYDOWN_STATE, ...over };
}

/**
 * A target month a fixed distance from whenever the suite happens to run,
 * instead of a hardcoded calendar date that silently stops meaning anything
 * once real time catches up to it.
 */
function monthsFromNow(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Shared by every test (asserted on directly by the autosave describe block
// below); reset fresh each time so call counts never leak between tests.
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
});

describe("DebtPaydownWorkspace", () => {
  it("says there is nothing to pay down when the household has no debts", () => {
    render(<DebtPaydownWorkspace dto={dto({ debts: [] })} />);
    expect(screen.getByText(/no debts on file/i)).toBeTruthy();
  });

  it("shows the debt-free month and the debt's own payoff", () => {
    const { container } = render(<DebtPaydownWorkspace dto={dto()} />);
    expect(container.textContent).toContain("Debt-free by");
    expect(container.textContent).toContain("Auto loan");
    expect(container.querySelector("[data-testid='paydown-chart']")).toBeTruthy();
  });

  // The nudge, not a dash: a debt we hold no numbers for is still the client's
  // debt and belongs on the list.
  it("offers inline fields for a debt with no rate or payment", () => {
    render(<DebtPaydownWorkspace dto={dto({ debts: [USABLE, NEEDS_RATE] })} />);
    expect(screen.getByLabelText("Interest rate for Store card")).toBeTruthy();
    expect(screen.getByLabelText("Monthly payment for Store card")).toBeTruthy();
    // Untickable until it has both.
    const tick = screen.getByLabelText("Include Store card") as HTMLInputElement;
    expect(tick.disabled).toBe(true);
  });

  // A real debt's payment override box was a hardcoded `value=""` —
  // parent-owned and never updated, so every keystroke arrived as a fresh
  // single character and the override ended up as whatever was typed LAST
  // (a client typing "250" stored "0"). Assert the STORED/effective value
  // via the real simulator's own output, not merely that the DOM changed —
  // the same lesson round 1's routing test learned.
  it("stores the whole typed number for a real debt's payment override, not just the last digit", () => {
    const { container } = render(
      <DebtPaydownWorkspace dto={dto({ debts: [USABLE, NEEDS_RATE] })} />,
    );

    fireEvent.change(screen.getByLabelText("Interest rate for Store card"), {
      target: { value: "22" },
    });
    const payment = screen.getByLabelText("Monthly payment for Store card") as HTMLInputElement;
    fireEvent.focus(payment);
    fireEvent.change(payment, { target: { value: "2" } });
    fireEvent.change(payment, { target: { value: "25" } });
    fireEvent.change(payment, { target: { value: "250" } });
    expect(payment.value).toBe("250");

    const now = new Date();
    const expected = comparePaydown(
      [
        { id: "l1", name: "Auto loan", balance: 18_400, annualRate: 0.059, minimumPayment: 415 },
        { id: "l2", name: "Store card", balance: 1_150, annualRate: 0.22, minimumPayment: 250 },
      ],
      {
        strategy: "avalanche",
        extraMonthly: 0,
        startYear: now.getFullYear(),
        startMonth: now.getMonth() + 1,
      },
    );
    // This fixture's baseline does pay off, so there IS a figure to show.
    expect(expected.interestSaved).not.toBeNull();
    expect(container.textContent).toContain(fmtUsd(expected.interestSaved!));
  });

  // The sibling rate box had the opposite flaw: uncontrolled, so nothing
  // ever seeded it — a saved override was invisible on return, even though
  // it was already live in the maths. Both boxes must show a saved override
  // on first paint, the rate converted from the stored fraction to a percent.
  it("renders a saved rate and payment override in their boxes on first paint", () => {
    const state = {
      ...DEFAULT_DEBT_PAYDOWN_STATE,
      overrides: { l2: { annualRate: 0.1899, minimumPayment: 45 } },
    };
    render(<DebtPaydownWorkspace dto={dto({ debts: [USABLE, NEEDS_RATE], state })} />);

    const rate = screen.getByLabelText("Interest rate for Store card") as HTMLInputElement;
    const payment = screen.getByLabelText("Monthly payment for Store card") as HTMLInputElement;
    expect(rate.value).toBe("18.99");
    expect(payment.value).toBe("45");
  });

  // Same rule as the manual fields: clearing a box to retype it must not
  // snap back to "0".
  it("lets a client clear a real debt's saved override instead of snapping it back to 0", () => {
    const state = {
      ...DEFAULT_DEBT_PAYDOWN_STATE,
      overrides: { l2: { annualRate: 0.1899, minimumPayment: 45 } },
    };
    render(<DebtPaydownWorkspace dto={dto({ debts: [USABLE, NEEDS_RATE], state })} />);

    const payment = screen.getByLabelText("Monthly payment for Store card") as HTMLInputElement;
    fireEvent.focus(payment);
    fireEvent.change(payment, { target: { value: "" } });
    expect(payment.value).toBe("");
  });

  it("tells the client when a payment cannot cover the interest", () => {
    const stalling = {
      id: "l3", name: "Visa", balance: 5_000, annualRate: 0.24,
      minimumPayment: 50, liabilityType: "credit_card", rateFromApr: true,
    };
    const { container } = render(<DebtPaydownWorkspace dto={dto({ debts: [stalling] })} />);
    expect(container.textContent).toContain("doesn't cover");
    expect(container.textContent).toContain("Visa");
  });

  // Corrected: the component renders a curly apostrophe (design-system
  // choice), not the ASCII one — the test matches what actually renders.
  it("solves for the payment that hits a target month", () => {
    const { container } = render(
      <DebtPaydownWorkspace
        dto={dto({
          state: { ...DEFAULT_DEBT_PAYDOWN_STATE, mode: "target", targetMonth: monthsFromNow(24) },
        })}
      />,
    );
    expect(container.textContent).toMatch(/you’d need/i);
  });

  // The target date used to be a native <input type="month">, whose month and
  // year segments are SPINBUTTONS — clicking them opens nothing, which reads
  // as a broken dropdown. Real <select>s are what a client expects, and they
  // are the only date control that behaves the same in every browser.
  it("picks the target date with real month and year dropdowns", () => {
    render(<DebtPaydownWorkspace dto={dto()} />);
    const month = screen.getByLabelText("Debt free by month");
    const year = screen.getByLabelText("Debt free by year");
    expect(month.tagName).toBe("SELECT");
    expect(year.tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: "February" })).toBeTruthy();
  });

  it("solves for the target only once BOTH dropdowns are chosen", () => {
    const target = monthsFromNow(24);
    const [y, m] = target.split("-");
    const { container } = render(<DebtPaydownWorkspace dto={dto()} />);

    // Month alone is a half-answer — it must not start solving for a date
    // the client hasn't finished naming.
    fireEvent.change(screen.getByLabelText("Debt free by month"), { target: { value: m } });
    expect(container.textContent).not.toMatch(/you’d need/i);

    fireEvent.change(screen.getByLabelText("Debt free by year"), { target: { value: y } });
    expect(container.textContent).toMatch(/you’d need/i);
  });

  // A target saved on an earlier visit can name a year that is now in the
  // past. If the dropdown only offers this year onward, it reads BLANK while
  // that stale date is still saved underneath it — the client sees no goal,
  // can't tell what they picked, and the stale value keeps saving.
  it("still offers a year saved before this one", () => {
    const lastYear = String(new Date().getFullYear() - 1);
    render(
      <DebtPaydownWorkspace
        dto={dto({
          state: {
            ...DEFAULT_DEBT_PAYDOWN_STATE,
            mode: "target",
            targetMonth: `${lastYear}-06`,
          },
        })}
      />,
    );
    const year = screen.getByLabelText("Debt free by year") as HTMLSelectElement;
    expect(year.value).toBe(lastYear);
  });

  it("recomputes when the extra payment changes", () => {
    const { container } = render(<DebtPaydownWorkspace dto={dto()} />);
    const before = container.textContent ?? "";
    fireEvent.change(screen.getByLabelText("Extra payment each month"), {
      target: { value: "500" },
    });
    expect(container.textContent).not.toBe(before);
  });

  // Two "Add a debt" clicks landing in the same millisecond of Date.now()
  // used to hand out the same id. The validator (shared with the route
  // handler) refuses duplicate manual-debt ids, so a collision here means the
  // client's whole setup silently fails to save.
  it("gives two debts added back-to-back distinct ids, so both survive validation", () => {
    // Pin Date.now() so both clicks land in the SAME millisecond — the exact
    // scenario `id: \`m${Date.now()}\`` (no counter) collides on. Without the
    // module-level counter this reproduces the bug reliably; two ordinary
    // fireEvent.click calls often don't, since real time can tick between them.
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    render(<DebtPaydownWorkspace dto={dto()} />);
    const addButton = screen.getByRole("button", { name: "Add a debt" });
    fireEvent.click(addButton);
    fireEvent.click(addButton);
    nowSpy.mockRestore();
    // Both rows still default to "New debt" — qualifying the label by name
    // (matching the rate/payment siblings) doesn't disambiguate two UNEDITED
    // rows, so this stays a count check rather than two individually
    // addressable fields.
    expect(screen.getAllByLabelText("Name for New debt")).toHaveLength(2);
    expect(screen.queryByText(/own id/i)).toBeNull();
  });

  // A hand-added debt used to render its name and balance as plain text and
  // route rate/payment edits into `overrides`, which manual rows never read —
  // so "Add a debt" led nowhere. All four fields must reach the maths: the
  // assertion below is the REAL simulator's own output for these exact
  // numbers, so a routing that silently drops any one of the four (balance
  // stuck at 0, or rate/payment misrouted back into `overrides`, which a
  // manual id never appears in) produces a DIFFERENT figure and fails.
  it("routes a hand-added debt's own fields into the maths", () => {
    const { container } = render(<DebtPaydownWorkspace dto={dto()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a debt" }));

    fireEvent.change(screen.getByLabelText("Name for New debt"), { target: { value: "New card" } });
    fireEvent.change(screen.getByLabelText("Balance for New card"), { target: { value: "4000" } });
    fireEvent.change(screen.getByLabelText("Interest rate for New card"), {
      target: { value: "20" },
    });
    fireEvent.change(screen.getByLabelText("Monthly payment for New card"), {
      target: { value: "200" },
    });

    expect((screen.getByLabelText("Name for New card") as HTMLInputElement).value).toBe(
      "New card",
    );

    const now = new Date();
    const expected = comparePaydown(
      [
        { id: "l1", name: "Auto loan", balance: 18_400, annualRate: 0.059, minimumPayment: 415 },
        { id: "manual", name: "New card", balance: 4_000, annualRate: 0.2, minimumPayment: 200 },
      ],
      {
        strategy: "avalanche",
        extraMonthly: 0,
        startYear: now.getFullYear(),
        startMonth: now.getMonth() + 1,
      },
    );
    // This fixture's baseline does pay off, so there IS a figure to show.
    expect(expected.interestSaved).not.toBeNull();
    expect(container.textContent).toContain(fmtUsd(expected.interestSaved!));
  });

  // A card whose minimum does not cover its own interest never clears, so
  // "just the minimums" is not a real outcome to measure against. Measured
  // off the simulator's 600-month ceiling instead, this exact debt claimed
  // "$16,143,991 saved" and "47 yr 9 mo saved" on the two headline tiles.
  it("shows no saving figures when paying the minimums never clears the debt", () => {
    const STUCK = {
      id: "l9",
      name: "Rewards card",
      balance: 8_000,
      annualRate: 0.1999,
      minimumPayment: 120,
      liabilityType: "credit_card",
      rateFromApr: false,
    };
    const { container } = render(<DebtPaydownWorkspace dto={dto({ debts: [STUCK] })} />);
    fireEvent.change(screen.getByLabelText("Extra payment each month"), {
      target: { value: "250" },
    });

    // The plan itself does pay off, so that tile still carries a real date.
    expect(container.textContent).toMatch(/Debt-free by/i);
    expect(container.textContent).not.toMatch(/Interest saved/i);
    expect(container.textContent).not.toMatch(/Time saved/i);
    expect(container.textContent).toMatch(/no .before. figure to measure your plan against/i);
    // The specific fabrications this replaced.
    expect(container.textContent).not.toMatch(/\$16,1\d\d,\d\d\d/);
    expect(container.textContent).not.toMatch(/47 yr/);
  });

  // Every included debt at (or already near) a zero balance leaves the chart
  // with fewer than two points, and the real chart component bails out to
  // `null` in that case — the workspace must not leave a bare bordered box.
  it("says there's nothing to chart when every included debt is already at zero", () => {
    const { container } = render(<DebtPaydownWorkspace dto={dto()} />);
    fireEvent.click(screen.getByLabelText("Include Auto loan"));
    fireEvent.click(screen.getByRole("button", { name: "Add a debt" }));
    fireEvent.change(screen.getByLabelText("Interest rate for New debt"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByLabelText("Monthly payment for New debt"), {
      target: { value: "50" },
    });

    expect(container.textContent).toMatch(/nothing left to pay down/i);
    expect(container.querySelector("[data-testid='paydown-chart']")).toBeNull();
  });

  // `GoalSeekResult.unreachable` is real and distinct from `alreadyOnTrack` —
  // even the entire remaining balance, paid every month, can't hit the
  // target. It must read as a plain "can't get there", never as a confident
  // dollar figure.
  it("says the target can't be reached instead of printing a bogus dollar figure", () => {
    solveExtraForTargetMock.mockReturnValueOnce({
      extraMonthly: 999_999,
      monthsToDebtFree: 600,
      alreadyOnTrack: false,
      unreachable: true,
    });
    const { container } = render(
      <DebtPaydownWorkspace
        dto={dto({
          state: { ...DEFAULT_DEBT_PAYDOWN_STATE, mode: "target", targetMonth: monthsFromNow(3) },
        })}
      />,
    );
    expect(container.textContent).toMatch(/not even paying the whole balance/i);
    expect(container.textContent).not.toContain("999,999");
  });

  // A controlled input whose `value` is re-derived from the parsed number
  // every render can't represent a state the number can't — most visibly a
  // trailing decimal point. CurrencyInput only shows its raw (unformatted)
  // value while focused, so these fire a real focus event first, matching
  // how a client actually gets to a field before typing into it.
  it("keeps a typed decimal point in every amount field instead of losing it on the next keystroke", () => {
    render(<DebtPaydownWorkspace dto={dto()} />);

    const extra = screen.getByLabelText("Extra payment each month") as HTMLInputElement;
    fireEvent.focus(extra);
    fireEvent.change(extra, { target: { value: "250.5" } });
    expect(extra.value).toBe("250.5");

    fireEvent.click(screen.getByRole("button", { name: "Add a debt" }));

    const balance = screen.getByLabelText("Balance for New debt") as HTMLInputElement;
    fireEvent.focus(balance);
    fireEvent.change(balance, { target: { value: "1500.25" } });
    expect(balance.value).toBe("1500.25");

    // Plain <input>, not CurrencyInput — no focused/idle formatting switch,
    // so no focus event is needed to see its raw value.
    const rate = screen.getByLabelText("Interest rate for New debt") as HTMLInputElement;
    fireEvent.change(rate, { target: { value: "5" } });
    expect(rate.value).toBe("5");
    fireEvent.change(rate, { target: { value: "5." } });
    expect(rate.value).toBe("5.");
    fireEvent.change(rate, { target: { value: "5.9" } });
    expect(rate.value).toBe("5.9");

    const payment = screen.getByLabelText("Monthly payment for New debt") as HTMLInputElement;
    fireEvent.focus(payment);
    fireEvent.change(payment, { target: { value: "89.99" } });
    expect(payment.value).toBe("89.99");

    // Clearing a field to retype it must not snap back to "0".
    fireEvent.change(payment, { target: { value: "" } });
    expect(payment.value).toBe("");
  });
});

describe("DebtPaydownWorkspace — autosave", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("PUTs the validated state once editing settles, after the debounce", async () => {
    vi.useFakeTimers();
    render(<DebtPaydownWorkspace dto={dto()} />);
    // Mounting alone must not write a row.
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Extra payment each month"), {
      target: { value: "50" },
    });
    // Still inside the 700ms debounce window.
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/portal/calculators/debt-paydown");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body as string) as { state: { extraMonthly: number } };
    expect(body.state.extraMonthly).toBe(50);
  });

  it("skips the PUT and shows the validator's own message when the state is locally invalid", async () => {
    vi.useFakeTimers();
    render(<DebtPaydownWorkspace dto={dto()} />);

    fireEvent.click(screen.getByRole("button", { name: "Add a debt" }));
    fireEvent.change(screen.getByLabelText("Name for New debt"), { target: { value: "" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Give each debt a name.")).toBeTruthy();
  });

  it("never PUTs in read-only preview mode, however long the debounce is given", async () => {
    vi.useFakeTimers();
    render(<DebtPaydownWorkspace dto={dto()} readOnly />);

    fireEvent.change(screen.getByLabelText("Extra payment each month"), {
      target: { value: "50" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
