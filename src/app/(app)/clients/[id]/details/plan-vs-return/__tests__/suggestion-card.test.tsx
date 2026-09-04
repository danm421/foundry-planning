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

import { SuggestionCard } from "../suggestion-card";
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
  it("renders both figures, the citation, the delta chip and the meaning line", () => {
    render(<SuggestionCard {...props()} />);
    expect(screen.getByText(/acme paid \$165,000/i)).toBeTruthy();
    expect(screen.getByText("Return 2025")).toBeTruthy();
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

  it("R61: the disabled dismiss button's reason is readable without a mouse", () => {
    render(<SuggestionCard {...props({ dismissalsUnavailable: true })} />);
    expect(screen.getByRole("button", { name: /not applicable/i })).toBeDisabled();
    // Visible text, not a title attribute a keyboard or screen-reader user never sees.
    expect(screen.getByText(/setting cards aside isn't available yet/i)).toBeTruthy();
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
    expect(screen.getByText("Differs").className).not.toContain("good");
  });
});
