// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { K1sEditor, BusinessesEditor } from "../entity-array-editor";
import { emptyK1 } from "@/lib/schemas/tax-return-facts";

const docs = [
  { id: "doc-1", role: "full_return" as const, filename: "1040.pdf", taxYear: 2024, warnings: [], createdAt: "2026-08-01T00:00:00.000Z", w2s: [] },
  { id: "doc-2", role: "k1" as const, filename: "k1-ridgeline.pdf", taxYear: 2024, warnings: [], createdAt: "2026-08-02T00:00:00.000Z", w2s: [] },
];

function k1(overrides: Partial<ReturnType<typeof emptyK1>> = {}) {
  return { ...emptyK1(), entityId: "ent-1", entityName: "Ridgeline Partners LLC", ein: "12-3456789", entityType: "partnership" as const, ordinaryBusinessIncome: 180_000, ...overrides };
}

describe("K1sEditor", () => {
  it("renders one card per K-1", () => {
    render(
      <K1sEditor k1s={[k1()]} w2Options={[]} provenance={{}} conflicts={[]} documents={docs} onChange={() => {}} />,
    );
    expect(screen.getByDisplayValue("Ridgeline Partners LLC")).toBeInTheDocument();
    expect(screen.getByDisplayValue("12-3456789")).toBeInTheDocument();
  });

  it("assigns owner W-2 wages from the dropdown, not by name-matching", async () => {
    const onChange = vi.fn();
    render(
      <K1sEditor
        k1s={[k1()]}
        w2Options={[{ employer: "Ridgeline Partners LLC", wages: 95_000 }]}
        provenance={{}} conflicts={[]} documents={docs} onChange={onChange}
      />,
    );
    const select = screen.getByLabelText(/owner W-2 wages/i) as HTMLSelectElement;
    // D10 is a MANUAL assignment. An employer name that exactly matches the
    // entity's own name must NOT pre-select anything — if a name-matching
    // heuristic ever crept in, this line goes red before any interaction.
    expect(select.value).toBe("");
    await userEvent.selectOptions(select, "Ridgeline Partners LLC");
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ w2WagesFromEntity: 95_000 }),
    ]);
  });

  it("shows a stored W-2 assignment even when its source document is gone", () => {
    render(
      <K1sEditor
        k1s={[k1({ w2WagesFromEntity: 95_000 })]}
        w2Options={[]}
        provenance={{}} conflicts={[]} documents={docs} onChange={() => {}}
      />,
    );
    const select = screen.getByLabelText(/owner W-2 wages/i) as HTMLSelectElement;
    expect(select.value).toBe("95000");
    expect(screen.getByText(/\$95,000/)).toBeInTheDocument();
    expect(screen.getByText(/source document removed/i)).toBeInTheDocument();
  });

  it("does not offer a W-2 pair with no wages figure as an assignment option", () => {
    render(
      <K1sEditor
        k1s={[k1()]}
        w2Options={[{ employer: "Ridgeline Partners LLC", wages: null }]}
        provenance={{}} conflicts={[]} documents={docs} onChange={() => {}}
      />,
    );
    const select = screen.getByLabelText(/owner W-2 wages/i) as HTMLSelectElement;
    expect(select.options).toHaveLength(1); // "Not assigned" only
  });

  it("preserves entityId when the advisor corrects a garbled name", async () => {
    const onChange = vi.fn();
    render(
      <K1sEditor k1s={[k1({ entityName: "R1DGEL1NE" })]} w2Options={[]} provenance={{}} conflicts={[]} documents={docs} onChange={onChange} />,
    );
    const nameInput = screen.getByDisplayValue("R1DGEL1NE");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "R");
    const last = onChange.mock.calls.at(-1)![0];
    expect(last[0].entityId).toBe("ent-1");
  });

  it("adds an empty K-1 with no entityId — merge stamps identity, not the form", async () => {
    const onChange = vi.fn();
    render(
      <K1sEditor k1s={[]} w2Options={[]} provenance={{}} conflicts={[]} documents={docs} onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /add k-1/i }));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ entityId: null })]);
  });

  it("removes the K-1 at the clicked index", async () => {
    const onChange = vi.fn();
    render(
      <K1sEditor
        k1s={[k1(), k1({ entityId: "ent-2", entityName: "Second LLC", ein: "98-7654321" })]}
        w2Options={[]} provenance={{}} conflicts={[]} documents={docs} onChange={onChange}
      />,
    );
    await userEvent.click(screen.getAllByRole("button", { name: /remove/i })[0]);
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ entityId: "ent-2" })]);
  });
});

describe("BusinessesEditor", () => {
  it("marks a field sourced from a document other than the 1040", () => {
    render(
      <BusinessesEditor
        businesses={[{ entityId: "b-1", name: "Cedar Consulting", netProfit: 40_000, grossReceipts: null, totalExpenses: null, depreciation: null, isSstb: null }]}
        provenance={{ "businesses[b-1].netProfit": "doc-2" }}
        conflicts={[]} documents={docs} onChange={() => {}}
      />,
    );
    expect(screen.getByTitle(/k1-ridgeline\.pdf/i)).toBeInTheDocument();
  });

  it("shows BOTH values and their documents for a conflicted field", () => {
    render(
      <BusinessesEditor
        businesses={[{ entityId: "b-1", name: "Cedar Consulting", netProfit: 40_000, grossReceipts: null, totalExpenses: null, depreciation: null, isSstb: null }]}
        provenance={{ "businesses[b-1].netProfit": "doc-1" }}
        conflicts={[{
          path: "businesses[b-1].netProfit",
          winner: { documentId: "doc-1", value: 40_000 },
          losers: [{ documentId: "doc-2", value: 41_500 }],
        }]}
        documents={docs} onChange={() => {}}
      />,
    );
    expect(screen.getByText(/1040\.pdf/)).toBeInTheDocument();
    expect(screen.getByText(/k1-ridgeline\.pdf/)).toBeInTheDocument();
    expect(screen.getByText(/41,500/)).toBeInTheDocument();
  });

  it("suppresses the conflict banner once an advisor override has resolved it", () => {
    render(
      <BusinessesEditor
        businesses={[{ entityId: "b-1", name: "Cedar Consulting", netProfit: 40_000, grossReceipts: null, totalExpenses: null, depreciation: null, isSstb: null }]}
        provenance={{ "businesses[b-1].netProfit": "advisor" }}
        conflicts={[{
          path: "businesses[b-1].netProfit",
          winner: { documentId: "doc-1", value: 40_000 },
          losers: [{ documentId: "doc-2", value: 41_500 }],
        }]}
        documents={docs} onChange={() => {}}
      />,
    );
    // deriveProvenance rewrites an overridden path to "advisor" but the merge
    // still reports the conflict unfiltered — the input already holds the
    // advisor's value, so neither document's filename nor the losing figure
    // should render.
    expect(screen.queryByText(/1040\.pdf/)).not.toBeInTheDocument();
    expect(screen.queryByText(/k1-ridgeline\.pdf/)).not.toBeInTheDocument();
    expect(screen.queryByText(/41,500/)).not.toBeInTheDocument();
  });

  it("renders no marker for a field sourced from the primary return", () => {
    render(
      <BusinessesEditor
        businesses={[{ entityId: "b-1", name: "Cedar Consulting", netProfit: 40_000, grossReceipts: null, totalExpenses: null, depreciation: null, isSstb: null }]}
        provenance={{ "businesses[b-1].netProfit": "doc-1" }}
        conflicts={[]} documents={docs} onChange={() => {}}
      />,
    );
    expect(screen.queryByTitle(/1040\.pdf/i)).not.toBeInTheDocument();
  });
});
