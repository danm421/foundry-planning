// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SuggestionCard, TONE_CLASS, rowLink } from "../suggestion-card";
import type { Suggestion } from "@/lib/tax-reconciliation/types";

const base: Suggestion = {
  id: "income.wages.w2.0",
  section: "income",
  kind: "update",
  status: "open",
  headline: "Acme paid $165,000 in 2025; the plan's Acme Corp is $150,000 in 2025 dollars.",
  meaning: "The W-2 is the actual figure for the year the return covers.",
  returnFigure: {
    label: "Acme · box 1",
    amount: 165_000,
    display: "$165,000",
    lineRefs: [{ form: "W-2", line: "Box 1", label: "Wages", amount: 165_000 }],
  },
  planFigure: { label: "Acme Corp", amount: 150_000, display: "$150,000", year: 2026 },
  delta: { amount: -15_000, display: "Plan is $15,000 short", tone: "short" },
  action: {
    label: "Set salary to $165,000",
    describe: "Sets Acme Corp to $165,000 (2025 dollars)",
    amountEditable: true,
    defaultAmount: 165_000,
    target: { kind: "income.update", incomeId: "i1", patch: {}, amountField: "annualAmount" },
  },
};

const noAction: Suggestion = {
  id: "income.socialSecurity.noProjection",
  section: "income",
  kind: "review",
  status: "open",
  headline: "The plan's Social Security cannot be stated: the projection did not run.",
  meaning: "Without a projection the plan's benefit is unknown rather than zero.",
  returnFigure: {
    label: "Social Security (gross)",
    amount: 42_000,
    display: "$42,000",
    lineRefs: [],
  },
  planFigure: { label: "Social Security in the plan", amount: null, display: "—", year: 2026 },
  delta: { amount: null, display: "Not known", tone: "neutral" },
  link: { label: "Open Inflows & Outflows", href: "/clients/c1/details/income-expenses" },
};

function props(over: Partial<React.ComponentProps<typeof SuggestionCard>> = {}) {
  return {
    suggestion: base,
    taxYear: 2025,
    busy: null,
    dismissalsUnavailable: false,
    onApply: vi.fn(),
    onDismiss: vi.fn(),
    onRestore: vi.fn(),
    ...over,
  };
}

describe("SuggestionCard", () => {
  it("puts both eyebrow labels in the same face, not one mono and its twin in Inter", () => {
    render(<SuggestionCard {...props()} />);
    expect(screen.getByText("Return 2025").className).toContain("tabular");
    expect(screen.getByText("Plan").className).toContain("tabular");
  });

  it("renders both figures, the citation, the delta chip and the meaning line", () => {
    render(<SuggestionCard {...props()} />);
    expect(screen.getByText(/acme paid \$165,000/i)).toBeTruthy();
    expect(screen.getByText("Return 2025")).toBeTruthy();
    // A year is a number: the eyebrow is the most-repeated element on the page.
    expect(screen.getByText("Return 2025").className).toContain("tabular");
    expect(screen.getByText("$165,000")).toBeTruthy();
    expect(screen.getByText("$150,000")).toBeTruthy();
    expect(screen.getByText(/W-2 Box 1/)).toBeTruthy();
    expect(screen.getByText("Plan is $15,000 short")).toBeTruthy();
    // R96: the meaning line stays on the canvas.
    expect(screen.getByText(/the w-2 is the actual figure/i)).toBeTruthy();
  });

  it("R69: the plan heading claims no year, because the figure is in tax-year dollars", () => {
    render(<SuggestionCard {...props()} />);
    expect(screen.getByText("Plan")).toBeTruthy();
    // The plan row's own year (2026) would label a 2025-dollar figure.
    expect(screen.queryByText("Plan 2026")).toBeNull();
  });

  it("puts every figure in the tabular numeral face", () => {
    const { container } = render(<SuggestionCard {...props()} />);
    for (const text of ["$165,000", "$150,000"]) {
      expect(screen.getByText(text).className).toContain("tabular");
    }
    // …and the accent never COLOURS a figure — it is reserved for action (a
    // focus ring on an editable field is action, and stays allowed).
    for (const el of container.querySelectorAll(".tabular")) {
      expect(el.className).not.toMatch(/\b(text|bg|border)-accent/);
    }
  });

  it("applies with the edited amount and rewrites the button label to match", async () => {
    const onApply = vi.fn();
    render(<SuggestionCard {...props({ onApply })} />);
    const amount = screen.getByRole("textbox", { name: /amount/i });
    await userEvent.clear(amount);
    await userEvent.type(amount, "170000");
    const button = screen.getByRole("button", { name: /set salary to \$170,000/i });
    await userEvent.click(button);
    expect(onApply).toHaveBeenCalledWith(170000, undefined);
  });

  it("blocks an apply with no amount rather than writing a zero", async () => {
    const onApply = vi.fn();
    render(<SuggestionCard {...props({ onApply })} />);
    await userEvent.clear(screen.getByRole("textbox", { name: /amount/i }));
    expect(screen.getByRole("button", { name: /set salary/i })).toBeDisabled();
    expect(onApply).not.toHaveBeenCalled();
  });

  // The rules no longer mark a negative figure editable (a loss-making business, a
  // rental that nets below its depreciation, a negative-AGI MAGI), so these two
  // cards should not exist. They are the belt to that braces: the box is unsigned,
  // and if a future rule ever hands one a negative default it must fail VISIBLY
  // rather than quietly apply the positive twin — a $10,000 swing on a card the
  // advisor never touched.
  const loss: Suggestion = {
    ...base,
    action: { ...base.action!, label: "Set to -$5,000", defaultAmount: -5_000 },
  };

  it("labels the button with the figure it would actually write, minus sign included", () => {
    render(<SuggestionCard {...props({ suggestion: loss })} />);
    expect(screen.getByRole("textbox", { name: /amount/i })).toHaveValue("-5000");
    expect(screen.getByRole("button", { name: /^set to/i }).textContent).toBe("Set to -$5,000");
  });

  it("refuses a negative amount rather than applying its positive twin", async () => {
    const onApply = vi.fn();
    render(<SuggestionCard {...props({ suggestion: loss, onApply })} />);
    const button = screen.getByRole("button", { name: /^set to/i });
    expect(screen.getByRole("textbox", { name: /amount/i })).toHaveAttribute("aria-invalid", "true");
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("passes the chosen owner when the action offers one", async () => {
    const onApply = vi.fn();
    const withOwner: Suggestion = {
      ...base,
      action: { ...base.action!, ownerChoices: ["client", "spouse"] },
    };
    render(<SuggestionCard {...props({ suggestion: withOwner, onApply })} />);
    await userEvent.click(screen.getByRole("radio", { name: /spouse/i }));
    await userEvent.click(screen.getByRole("button", { name: /set salary/i }));
    expect(onApply).toHaveBeenCalledWith(165000, "spouse");
  });

  it("R61: a write in flight disables every control and marks the card busy", () => {
    render(<SuggestionCard {...props({ busy: "apply" })} />);
    const card = screen.getByRole("article");
    expect(card).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("textbox", { name: /amount/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /applying/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /not applicable/i })).toBeDisabled();
  });

  it("R61: disables the owner picker too while a write is in flight", () => {
    const withOwner: Suggestion = {
      ...base,
      action: { ...base.action!, ownerChoices: ["client", "spouse"] },
    };
    render(<SuggestionCard {...props({ suggestion: withOwner, busy: "apply" })} />);
    expect(screen.getByRole("radio", { name: /spouse/i })).toBeDisabled();
  });

  it("R61: an outage disables BOTH writes to the dismissals store", () => {
    render(<SuggestionCard {...props({ dismissalsUnavailable: true })} />);
    expect(screen.getByRole("button", { name: /not applicable/i })).toBeDisabled();
    // Restore writes to the same store, so the same outage takes it out.
    render(
      <SuggestionCard
        {...props({ suggestion: { ...base, status: "dismissed" }, dismissalsUnavailable: true })}
      />,
    );
    expect(screen.getByRole("button", { name: /restore/i })).toBeDisabled();
    // The reason itself is page-level now: repeating it beside a dozen dead
    // buttons shouted one sentence a dozen times.
    expect(screen.queryByText(/setting cards aside isn't available/i)).toBeNull();
  });

  it("renders a suggestion that carries no action without offering a write", () => {
    render(<SuggestionCard {...props({ suggestion: noAction })} />);
    // A dash is not a numeral, so it does not take the numeral face.
    expect(screen.getByText("—").className).not.toContain("tabular");
    expect(screen.getByText("Not known")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: /amount/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /set salary/i })).toBeNull();
    // The review link is still offered, and the card can still be set aside.
    expect(screen.getByRole("link", { name: /open inflows & outflows/i }).getAttribute("href")).toBe(
      "/clients/c1/details/income-expenses",
    );
    expect(screen.getByRole("button", { name: /not applicable/i })).toBeTruthy();
  });

  it("offers only Restore on a dismissed card", async () => {
    const onRestore = vi.fn();
    render(
      <SuggestionCard {...props({ suggestion: { ...base, status: "dismissed" }, onRestore })} />,
    );
    expect(screen.queryByRole("button", { name: /set salary/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^not applicable$/i })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /restore/i }));
    expect(onRestore).toHaveBeenCalled();
  });

  it("does not colour a merely-different delta as good news", () => {
    const differs: Suggestion = {
      ...base,
      delta: { amount: null, display: "Differs", tone: "neutral" },
    };
    render(<SuggestionCard {...props({ suggestion: differs })} />);
    const chip = screen.getByText("Differs");
    expect(chip.className).not.toContain("good");
    expect(chip.className).not.toContain("chip-drift");
  });

  it("never renders the delta as an uppercased sentence", () => {
    // `.chip` is a status-token style: uppercase at 0.1em turns "Plan is
    // $15,000 short" into PLAN IS $15,000 SHORT, on every card down the page.
    render(<SuggestionCard {...props()} />);
    const chip = screen.getByText("Plan is $15,000 short");
    expect(chip.className).toContain("chip-sentence");
    // Every tone, not just the drift ones — a neutral delta is a sentence too.
    for (const cls of Object.values(TONE_CLASS)) {
      expect(cls.split(/\s+/)).toContain("chip-sentence");
    }
    const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    const rule = css.slice(css.indexOf(".chip-sentence {"));
    expect(rule.slice(0, rule.indexOf("}"))).toContain("text-transform: none");
  });

  it("weighs a plan running over exactly as heavily as one running short", () => {
    // A single tone cannot encode risk direction — over is the dangerous way to
    // be wrong on income and the conservative one on expenses — so neither
    // direction may be muted relative to the other.
    expect(TONE_CLASS.over).toBe(TONE_CLASS.short);
    expect(TONE_CLASS.extra).toBe(TONE_CLASS.missing);
    expect(TONE_CLASS.short).not.toBe(TONE_CLASS.neutral);
  });

  it("keys every tone to a class that exists beside .chip, never a Tailwind utility", () => {
    const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    const tones = [...new Set(Object.values(TONE_CLASS).flatMap((v) => v.split(/\s+/)))].filter(Boolean);
    expect(tones.length).toBeGreaterThan(0);
    for (const cls of tones) {
      // Tailwind emits its utilities inside `@layer utilities` while `.chip` is
      // unlayered, so `.chip`'s own color/border beat any `text-*` utility on
      // the same element whatever the specificity — a utility tone renders
      // NOTHING. The tone has to be a real unlayered rule next to `.chip`.
      expect(css).toContain(`.${cls} {`);
    }
    for (const cls of Object.values(TONE_CLASS)) {
      expect(cls).not.toMatch(/\b(text|border|bg)-(warn|good|crit|ink|accent)/);
    }
  });

  it("sends a deduction write to the screen that actually edits it", () => {
    // `/details/deductions` is LegacyDeductionsRedirect — it forwards to
    // Assumptions, so a "Deductions" link lands the advisor somewhere the name
    // does not match and the sidebar does not list.
    const deduction: Suggestion = {
      ...base,
      action: {
        ...base.action!,
        target: { kind: "deduction.update", deductionId: "d1", patch: { annualAmount: 1 }, amountField: "annualAmount" },
      },
    };
    expect(rowLink(deduction, "c1")).toEqual({
      href: "/clients/c1/details/assumptions",
      label: "Assumptions",
    });
  });

  it("gives every card a heading and an accessible name", () => {
    render(<SuggestionCard {...props()} />);
    const heading = screen.getByRole("heading", { name: /acme paid/i });
    expect(heading.tagName).toBe("H4");
    expect(screen.getByRole("article").getAttribute("aria-labelledby")).toBe(heading.id);
    expect(heading.id).toBeTruthy();
  });
});
