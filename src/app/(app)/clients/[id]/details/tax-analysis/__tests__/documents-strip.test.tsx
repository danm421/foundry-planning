// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentsStrip } from "../documents-strip";

const docs = [
  {
    id: "doc-1", role: "full_return" as const, filename: "1040-2024.pdf", taxYear: 2024,
    warnings: [], createdAt: "2026-08-01T00:00:00.000Z", w2s: [],
  },
  {
    id: "doc-2", role: "k1" as const, filename: "k1-ridgeline.pdf", taxYear: 2024,
    warnings: ["Truncated — verify."], createdAt: "2026-08-02T00:00:00.000Z", w2s: [],
  },
];

const noop = () => {};

describe("DocumentsStrip", () => {
  it("renders one row per document with a readable role label", () => {
    render(
      <DocumentsStrip documents={docs} unavailable={false} busy={false} onAdd={noop} onRemove={noop} />,
    );
    expect(screen.getByText("1040-2024.pdf")).toBeInTheDocument();
    expect(screen.getByText("k1-ridgeline.pdf")).toBeInTheDocument();
    expect(screen.getByText(/Form 1040/i)).toBeInTheDocument();
    expect(screen.getByText(/Schedule K-1/i)).toBeInTheDocument();
  });

  it("surfaces a document's warning count", () => {
    render(
      <DocumentsStrip documents={docs} unavailable={false} busy={false} onAdd={noop} onRemove={noop} />,
    );
    expect(screen.getByText(/1 warning/i)).toBeInTheDocument();
  });

  it("confirms before removing, and passes the document id when confirmed", async () => {
    const onRemove = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <DocumentsStrip documents={docs} unavailable={false} busy={false} onAdd={noop} onRemove={onRemove} />,
    );
    await userEvent.click(screen.getAllByRole("button", { name: /remove/i })[1]);
    expect(onRemove).toHaveBeenCalledWith("doc-2");
  });

  it("does not remove when the confirm is declined", async () => {
    const onRemove = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <DocumentsStrip documents={docs} unavailable={false} busy={false} onAdd={noop} onRemove={onRemove} />,
    );
    await userEvent.click(screen.getAllByRole("button", { name: /remove/i })[0]);
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("reports itself unavailable instead of showing an empty list pre-migration", () => {
    render(
      <DocumentsStrip documents={[]} unavailable busy={false} onAdd={noop} onRemove={noop} />,
    );
    expect(screen.getByText(/not available yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add document/i })).not.toBeInTheDocument();
  });

  it("disables adding while a document is being processed", () => {
    render(
      <DocumentsStrip documents={docs} unavailable={false} busy onAdd={noop} onRemove={noop} />,
    );
    expect(screen.getByRole("button", { name: /add document/i })).toBeDisabled();
  });
});
