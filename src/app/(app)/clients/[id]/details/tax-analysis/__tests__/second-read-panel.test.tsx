// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SecondReadPanel } from "../second-read-panel";
import type { SecondRead } from "@/lib/tax-returns/second-read/types";

function read(over: Partial<SecondRead> = {}): SecondRead {
  return {
    generatedAt: "2026-08-10T12:00:00.000Z",
    warnings: [],
    items: [
      {
        id: "sr-1",
        headline: "Form 8283 noncash gift may need a qualified appraisal",
        detail: "The packet includes a Form 8283 Section B reporting donated property.",
        form: "Form 8283", line: "Section B", quotedValue: "$28,500", dismissed: false,
      },
      {
        id: "sr-2", headline: "An installment sale is reported on Form 6252",
        detail: "Form 6252 is attached.", form: "Form 6252", line: null, quotedValue: null,
        dismissed: false,
      },
    ],
    ...over,
  };
}

const noop = () => {};

describe("SecondReadPanel", () => {
  it("offers to run the read when none exists", () => {
    render(<SecondReadPanel secondRead={null} stale={false} busy={false} error={null} onGenerate={noop} onDismiss={noop} />);
    expect(screen.getByRole("button", { name: /run ai second read/i })).toBeInTheDocument();
    expect(screen.queryByText(/Form 8283/)).not.toBeInTheDocument();
  });

  it("labels every item AI-read and unverified", () => {
    render(<SecondReadPanel secondRead={read()} stale={false} busy={false} error={null} onGenerate={noop} onDismiss={noop} />);
    expect(screen.getAllByText(/ai-read · unverified/i)).toHaveLength(2);
  });

  it("renders a transcription with the form and line it came from", () => {
    render(<SecondReadPanel secondRead={read()} stale={false} busy={false} error={null} onGenerate={noop} onDismiss={noop} />);
    expect(screen.getByText(/Form 8283 · Section B · \$28,500/)).toBeInTheDocument();
  });

  it("renders a citation with no transcription without a trailing separator", () => {
    render(<SecondReadPanel secondRead={read()} stale={false} busy={false} error={null} onGenerate={noop} onDismiss={noop} />);
    expect(screen.getByText("Form 6252")).toBeInTheDocument();
  });

  it("hides dismissed items", () => {
    const r = read();
    r.items[0].dismissed = true;
    render(<SecondReadPanel secondRead={r} stale={false} busy={false} error={null} onGenerate={noop} onDismiss={noop} />);
    expect(screen.queryByText(/Form 8283 noncash gift/)).not.toBeInTheDocument();
    expect(screen.getByText(/installment sale/)).toBeInTheDocument();
  });

  it("calls onDismiss with the item id", async () => {
    const onDismiss = vi.fn();
    render(<SecondReadPanel secondRead={read()} stale={false} busy={false} error={null} onGenerate={noop} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole("button", { name: /dismiss form 8283 noncash gift/i }));
    expect(onDismiss).toHaveBeenCalledWith("sr-1");
  });

  it("warns that regenerating clears dismissals — the stated behaviour, surfaced", () => {
    render(<SecondReadPanel secondRead={read()} stale={true} busy={false} error={null} onGenerate={noop} onDismiss={noop} />);
    expect(screen.getByText(/documents have changed/i)).toBeInTheDocument();
    expect(screen.getByText(/clears any items you.ve dismissed/i)).toBeInTheDocument();
  });

  it("still shows the stale read's items rather than blanking the panel", () => {
    render(<SecondReadPanel secondRead={read()} stale={true} busy={false} error={null} onGenerate={noop} onDismiss={noop} />);
    expect(screen.getByText(/Form 8283 noncash gift/)).toBeInTheDocument();
  });

  it("says nothing was found rather than rendering an empty box", () => {
    render(
      <SecondReadPanel secondRead={read({ items: [] })} stale={false} busy={false} error={null} onGenerate={noop} onDismiss={noop} />,
    );
    expect(screen.getByText(/didn't find anything/i)).toBeInTheDocument();
  });

  it("says nothing was found when every item is dismissed", () => {
    const r = read();
    r.items.forEach((i) => { i.dismissed = true; });
    render(<SecondReadPanel secondRead={r} stale={false} busy={false} error={null} onGenerate={noop} onDismiss={noop} />);
    expect(screen.getByText(/didn't find anything/i)).toBeInTheDocument();
  });

  it("surfaces documents that could not be read — 'nothing found' must not mean 'nothing looked at'", () => {
    render(
      <SecondReadPanel
        secondRead={read({ warnings: ["k1.pdf couldn't be read from the document vault."] })}
        stale={false} busy={false} error={null} onGenerate={noop} onDismiss={noop}
      />,
    );
    expect(screen.getByText(/k1.pdf couldn't be read/)).toBeInTheDocument();
  });

  it("disables both actions while busy", () => {
    render(<SecondReadPanel secondRead={read()} stale={false} busy={true} error={null} onGenerate={noop} onDismiss={noop} />);
    expect(screen.getByRole("button", { name: /second read/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /dismiss form 8283 noncash gift/i })).toBeDisabled();
  });

  // The page-level banner sits ~4000px above this panel, so a failure reported
  // there is off-screen for the advisor who pressed the button. The message has
  // to live next to the control that produced it.
  it("reports a failure inside the panel, next to the button that produced it", () => {
    render(
      <SecondReadPanel
        secondRead={null} stale={false} busy={false} error="AI features aren't enabled for this firm."
        onGenerate={noop} onDismiss={noop}
      />,
    );
    const panel = screen.getByRole("region", { name: /ai second read/i });
    expect(within(panel).getByText(/ai features aren't enabled/i)).toBeInTheDocument();
  });

  it("renders no failure line when there is no failure", () => {
    render(<SecondReadPanel secondRead={read()} stale={false} busy={false} error={null} onGenerate={noop} onDismiss={noop} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
