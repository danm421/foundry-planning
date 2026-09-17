// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { HoldingOverrideEditor } from "../holding-override-editor";
import type { HoldingRow } from "@/lib/investments/holdings-client";

const ASSET_CLASSES = [
  { id: "ac-lc", name: "US Large Cap", slug: "us_large_cap", geometricReturn: 0.07 },
  { id: "ac-sc", name: "US Small Cap", slug: "us_small_cap", geometricReturn: 0.08 },
  { id: "ac-em", name: "Emerging Markets", slug: "emerging_markets", geometricReturn: 0.08 },
  { id: "ac-tips", name: "TIPS", slug: "tips", geometricReturn: 0.02 },
  { id: "ac-cash", name: "Cash", slug: "cash", geometricReturn: 0 },
];

function holding(over: Partial<HoldingRow> = {}): HoldingRow {
  return {
    id: "h1", accountId: "a1", securityId: null,
    displayTicker: "ABCDX", displayName: "Some Fund",
    shares: "100", price: "10", priceAsOf: null, costBasis: "900",
    marketValue: null, sortOrder: 0, notes: null,
    securityWeights: [], overrides: [], needsReview: true,
    ...over,
  };
}

function renderEditor(over: Partial<HoldingRow> = {}, onSave = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  render(
    <HoldingOverrideEditor
      holding={holding(over)}
      assetClasses={ASSET_CLASSES}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  return { onSave, onClose };
}

const pctField = (name: string) => screen.getByLabelText(`${name} percent`) as HTMLInputElement;

describe("HoldingOverrideEditor", () => {
  afterEach(cleanup);

  it("opens as its own dialog rather than expanding the holdings row", () => {
    renderEditor();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBe("Asset classes — ABCDX");
  });

  // The whole point of the popup: an unclassified holding shows every class, so
  // the advisor scrolls one list instead of hunting for a class to reveal.
  it("lists every asset class with its own percent field, including the ones at 0%", () => {
    renderEditor({ securityWeights: [{ slug: "us_large_cap", weight: 1 }] });
    const dialog = screen.getByRole("dialog");
    for (const ac of ASSET_CLASSES) {
      expect(within(dialog).getByLabelText(`${ac.name} percent`)).toBeDefined();
    }
    expect(pctField("US Large Cap").value).toBe("100");
    expect(pctField("TIPS").value).toBe("");
  });

  it("saves the typed blend, dropping the classes left blank", async () => {
    const { onSave, onClose } = renderEditor();
    fireEvent.change(pctField("US Large Cap"), { target: { value: "60" } });
    fireEvent.change(pctField("Emerging Markets"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith([
      { assetClassId: "ac-lc", weight: 0.6 },
      { assetClassId: "ac-em", weight: 0.4 },
    ]);
  });

  it("reports what is still unclassified while the blend is short of 100%", () => {
    renderEditor();
    fireEvent.change(pctField("US Large Cap"), { target: { value: "70" } });
    expect(screen.getByText(/unclassified/)).toBeDefined();
    expect(screen.getByText("30.0%")).toBeDefined();
  });

  it("blocks Save when the weights exceed 100%", () => {
    renderEditor();
    fireEvent.change(pctField("US Large Cap"), { target: { value: "80" } });
    fireEvent.change(pctField("US Small Cap"), { target: { value: "80" } });
    expect(screen.getByText(/exceeds 100%/)).toBeDefined();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  // The dialog renders inside the account form's DOM, so a bare Enter would
  // submit that form out from under the user.
  it("moves down the list on Enter instead of submitting the form around it", () => {
    renderEditor();
    const first = pctField("US Large Cap");
    first.focus();
    const ev = fireEvent.keyDown(first, { key: "Enter" });
    expect(ev).toBe(false); // preventDefault() was called
    expect(document.activeElement).toBe(pctField("US Small Cap"));
  });

  it("clears the override when the fields still match the pulled blend", async () => {
    const { onSave } = renderEditor({ securityWeights: [{ slug: "us_large_cap", weight: 1 }] });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith([]));
  });
});
