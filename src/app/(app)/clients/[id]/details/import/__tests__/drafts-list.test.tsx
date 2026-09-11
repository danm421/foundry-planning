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
    surface: undefined,
    ...overrides,
  } as ImportListRow;
}

// Round 1 review finding: the RESUME half of C1 (list.ts deriving `surface`,
// drafts-list.tsx branching href/label on it) had no test — only the CREATE
// half did. If that derivation ever silently yields `undefined` for a real
// chat draft, it reopens in the ordinary wizard with no error anywhere.
describe("DraftsList — resumes a chat draft on the chat surface, not the wizard", () => {
  it("routes and labels a chat draft distinctly from a plain draft", () => {
    const chatRow = makeRow({ id: "chat-1", surface: "chat" });
    const wizardRow = makeRow({ id: "wizard-1", surface: undefined });

    const { container } = render(
      <DraftsList clientId="c1" inProgress={[chatRow, wizardRow]} completed={[]} />,
    );
    const links = Array.from(container.querySelectorAll("li a"));

    const chatLink = links.find((a) => a.getAttribute("href")?.includes("chat-1"));
    expect(chatLink).toHaveAttribute("href", "/clients/c1/details/import/chat-1/chat");
    expect(chatLink?.textContent).toContain("Statement chat");

    const wizardLink = links.find((a) => a.getAttribute("href")?.includes("wizard-1"));
    expect(wizardLink).toHaveAttribute("href", "/clients/c1/details/import/wizard-1");
    expect(wizardLink?.textContent).toContain("Onboarding");
  });
});
