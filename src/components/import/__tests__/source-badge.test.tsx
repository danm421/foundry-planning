// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import SourceBadge, { SourceFilesContext } from "../source-badge";

const FILES = { "file-1": "Schwab_Statement.pdf" };

function renderBadge(row: unknown, files: Record<string, string> = FILES) {
  return render(
    <SourceFilesContext.Provider value={files}>
      <SourceBadge row={row} />
    </SourceFilesContext.Provider>,
  );
}

describe("SourceBadge", () => {
  it("names the source document for a single-page row", () => {
    renderBadge({
      __provenance: { sourceFileId: "file-1", section: "accounts", pageRange: [3, 3] },
    });
    expect(
      screen.getByLabelText("From Schwab_Statement.pdf · p. 3"),
    ).toBeInTheDocument();
  });

  it("renders a page range as pp. start–end", () => {
    renderBadge({
      __provenance: { sourceFileId: "file-1", section: "accounts", pageRange: [8, 10] },
    });
    expect(
      screen.getByLabelText("From Schwab_Statement.pdf · pp. 8–10"),
    ).toBeInTheDocument();
  });

  it("omits the page suffix when there is no page range", () => {
    renderBadge({ __provenance: { sourceFileId: "file-1", section: "accounts" } });
    expect(screen.getByLabelText("From Schwab_Statement.pdf")).toBeInTheDocument();
  });

  it("falls back to a generic name when the file id is unknown", () => {
    renderBadge({ __provenance: { sourceFileId: "missing", section: "accounts" } });
    expect(screen.getByLabelText("From source document")).toBeInTheDocument();
  });

  it("renders nothing for a row without provenance", () => {
    const { container } = renderBadge({ name: "Hand-added account" });
    expect(container.firstChild).toBeNull();
  });
});
