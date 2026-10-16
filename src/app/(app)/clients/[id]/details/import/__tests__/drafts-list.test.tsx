// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import DraftsList from "../drafts-list";
import type { ImportListRow } from "@/lib/imports/list";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function makeRow(overrides: Partial<ImportListRow>): ImportListRow {
  return {
    id: "row-1",
    clientId: "c1",
    orgId: "org_1",
    scenarioId: null,
    mode: "onboarding",
    status: "draft",
    createdByUserId: "user_1",
    committedByUserId: null,
    committedAt: null,
    aiImportCounted: false,
    extractHoldings: false,
    discardedAt: null,
    notes: null,
    payloadJson: {},
    perTabCommittedAt: {},
    origin: "extraction",
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    fileCount: 0,
    extractionCount: 0,
    factFinder: false,
    ...overrides,
  } as ImportListRow;
}

// The RESUME half of the switch: if the list row's `factFinder` flag ever
// silently comes back false for a real fact finder draft (or a statement-chat
// draft from before the switch), it reopens in the wizard with no error.
describe("DraftsList — resumes a fact finder draft on the fact finder screen, not the wizard", () => {
  it("routes and labels fact finder drafts distinctly from a plain draft", () => {
    // A legacy chat draft and a new fact finder draft both carry factFinder: true.
    const legacyChatRow = makeRow({ id: "chat-1", factFinder: true });
    const factFinderRow = makeRow({ id: "ff-1", factFinder: true });
    const wizardRow = makeRow({ id: "wizard-1", factFinder: false });

    const { container } = render(
      <DraftsList
        clientId="c1"
        inProgress={[legacyChatRow, factFinderRow, wizardRow]}
        completed={[]}
      />,
    );
    const links = Array.from(container.querySelectorAll("li a"));

    for (const id of ["chat-1", "ff-1"]) {
      const link = links.find((a) => a.getAttribute("href")?.includes(id));
      expect(link).toHaveAttribute("href", `/clients/c1/details/import/${id}/fact-finder`);
      expect(link?.textContent).toContain("Fact finder import");
      expect(link?.textContent).not.toContain("Statement chat");
    }

    const wizardLink = links.find((a) => a.getAttribute("href")?.includes("wizard-1"));
    expect(wizardLink).toHaveAttribute("href", "/clients/c1/details/import/wizard-1");
    expect(wizardLink?.textContent).toContain("Onboarding");
  });
});
