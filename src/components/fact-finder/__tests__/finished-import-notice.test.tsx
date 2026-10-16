// @vitest-environment jsdom
// src/components/fact-finder/__tests__/finished-import-notice.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FinishedImportNotice } from "../finished-import-notice";

// Midday UTC, so the browser's own timezone still makes it October 8.
describe("FinishedImportNotice", () => {
  it("says the import was finished in statement chat and when, and how to change the plan now", () => {
    render(<FinishedImportNotice clientId="c1" finishedAt="2026-10-08T12:00:00.000Z" />);
    expect(screen.getByRole("heading", { level: 1, name: "Fact finder import" })).toBeInTheDocument();
    expect(screen.getByText(/^This import was finished in statement chat on/)).toHaveTextContent(
      /^This import was finished in statement chat on October 8, 2026\. Start a new import to change the plan\.$/,
    );
    expect(screen.getByText("October 8, 2026")).toHaveAttribute("dateTime", "2026-10-08T12:00:00.000Z");
  });

  it("links back to the imports list, and offers nothing to edit", () => {
    render(<FinishedImportNotice clientId="c1" finishedAt="2026-10-08T12:00:00.000Z" />);
    expect(screen.getByRole("link", { name: "← Back to imports" })).toHaveAttribute("href", "/clients/c1/details/import");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
