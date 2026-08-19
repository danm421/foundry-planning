// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DebtPaydownWorkspace } from "@/components/portal/debt-paydown-workspace";
import { DEFAULT_DEBT_PAYDOWN_STATE } from "@/lib/calculators/debt-paydown-state";
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

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
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
    expect(screen.getAllByLabelText("Debt name")).toHaveLength(2);
    expect(screen.queryByText(/own id/i)).toBeNull();
  });

  // A hand-added debt used to render its name and balance as plain text and
  // route rate/payment edits into `overrides`, which manual rows never read —
  // so "Add a debt" led nowhere. All four fields must reach the maths.
  it("routes a hand-added debt's own fields into the maths", () => {
    const { container } = render(<DebtPaydownWorkspace dto={dto()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a debt" }));
    const beforeFill = container.textContent ?? "";

    fireEvent.change(screen.getByLabelText("Debt name"), { target: { value: "New card" } });
    fireEvent.change(screen.getByLabelText("Debt balance"), { target: { value: "4000" } });
    fireEvent.change(screen.getByLabelText("Interest rate for New card"), {
      target: { value: "20" },
    });
    fireEvent.change(screen.getByLabelText("Monthly payment for New card"), {
      target: { value: "200" },
    });

    // Field values live in <input>s, which contribute nothing to
    // `textContent` — assert the value directly, then prove the number
    // actually reached the maths (the payoff dates, saved-interest figure)
    // by checking the surrounding read-only text changed.
    expect((screen.getByLabelText("Debt name") as HTMLInputElement).value).toBe("New card");
    expect(container.textContent).not.toBe(beforeFill);
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
});
