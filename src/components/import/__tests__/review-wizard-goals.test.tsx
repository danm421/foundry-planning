// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ReviewWizard from "@/components/import/review-wizard";
import { emptyImportPayload } from "@/lib/imports/types";
import type { EducationGoal } from "@/lib/imports/assemble/types";
import { blank } from "@/lib/imports/assemble/field";
import type { GrowthContext } from "@/lib/investments/growth-context";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/client-1",
}));

const NOW = "2026-07-01T00:00:00.000Z";

/**
 * Spreads over a complete EducationGoal so each test overrides only the
 * field it asserts on — same convention as goals-step.test.tsx's fixture.
 */
function educationGoalFixture(over: Partial<EducationGoal> = {}): EducationGoal {
  return {
    id: "edu:emma",
    name: { value: "Emma — College", provenance: "document" },
    forFamilyMemberName: { value: "Emma", provenance: "document" },
    annualAmount: { value: 45000, provenance: "stated" },
    startYear: { value: 2028, provenance: "stated" },
    years: { value: 4, provenance: "stated" },
    growthRate: { value: 0.05, provenance: "stated" },
    payShortfallOutOfPocket: { value: false, provenance: "stated" },
    dedicatedAccountNames: [],
    ...over,
  };
}

const growthContext: GrowthContext = {
  modelPortfolios: [],
  fundPortfolios: [],
  resolvedInflationRate: 0.03,
  categoryDefaults: {},
};

const baseProps = {
  clientId: "client-1",
  importId: "import-1",
  defaultStartYear: 2026,
  defaultEndYear: 2076,
  growthContext,
  fileNames: {},
};

describe("ReviewWizard — Goals tab", () => {
  it("shows the Goals tab even when the import has no goals and no rows", () => {
    render(
      <ReviewWizard
        {...baseProps}
        payload={emptyImportPayload()}
        perTabCommittedAt={null}
      />,
    );
    expect(screen.getByRole("button", { name: /^Goals/ })).toBeInTheDocument();
  });

  it("does not block completion when Goals is empty", () => {
    render(
      <ReviewWizard
        {...baseProps}
        payload={emptyImportPayload()}
        perTabCommittedAt={{ "plan-basics": NOW }}
      />,
    );
    // requiredCommitTabs only demands "plan-basics" (always-required) when
    // Goals carries zero rows — Goals itself must not become a second
    // mandatory tab. Navigate to Summary, the only place "All tabs
    // committed" renders.
    fireEvent.click(screen.getByRole("button", { name: /^Summary/ }));
    expect(screen.getByText(/all tabs committed/i)).toBeInTheDocument();
  });

  it("disables the Goals commit while a goal references an uncommitted 529", () => {
    const payload = {
      ...emptyImportPayload(),
      accounts: [
        {
          name: "Emma 529 Plan",
          subType: "529" as const,
          category: "education_savings" as const,
          match: { kind: "new" as const },
        },
      ],
      goals: {
        education: [educationGoalFixture({ dedicatedAccountNames: ["Emma 529 Plan"] })],
        homePurchases: [],
        riskTolerance: blank<string>(),
      },
    };
    render(<ReviewWizard {...baseProps} payload={payload} perTabCommittedAt={null} />);
    fireEvent.click(screen.getByRole("button", { name: /^Goals/ }));
    const commit = screen.getByRole("button", { name: /commit/i });
    expect(commit).toBeDisabled();
    expect(screen.getByText(/commit the Accounts step first/i)).toBeInTheDocument();
  });

  it("enables the Goals commit once Accounts is committed", () => {
    const payload = {
      ...emptyImportPayload(),
      accounts: [
        {
          name: "Emma 529 Plan",
          subType: "529" as const,
          category: "education_savings" as const,
          match: { kind: "new" as const },
        },
      ],
      goals: {
        education: [educationGoalFixture({ dedicatedAccountNames: ["Emma 529 Plan"] })],
        homePurchases: [],
        riskTolerance: blank<string>(),
      },
    };
    render(
      <ReviewWizard
        {...baseProps}
        payload={payload}
        perTabCommittedAt={{ accounts: NOW }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Goals/ }));
    expect(screen.getByRole("button", { name: /commit/i })).toBeEnabled();
  });

  it("round-trips goal edits through buildLatestPayload", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const payload = {
      ...emptyImportPayload(),
      goals: {
        education: [educationGoalFixture({ annualAmount: { value: null, provenance: "derived" } })],
        homePurchases: [],
        riskTolerance: blank<string>(),
      },
    };
    render(
      <ReviewWizard
        {...baseProps}
        payload={payload}
        perTabCommittedAt={{ accounts: NOW }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Goals/ }));
    fireEvent.change(screen.getByLabelText(/annual cost/i), { target: { value: "45000" } });
    fireEvent.click(screen.getByRole("button", { name: /commit/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(patchCall).toBeDefined();
    const body = JSON.parse(patchCall![1].body as string);
    // handleCommit PATCHes `{ payloadJson: { payload: latest } }` — see
    // review-wizard.tsx's handleCommit. Not `body.payload.goals` directly.
    expect(body.payloadJson.payload.goals.education[0].annualAmount).toEqual({
      value: 45000,
      provenance: "stated",
    });

    vi.unstubAllGlobals();
  });
});

/**
 * FINAL-REVIEW FINDING 3 — `handleCommit` awaited the commit POST and threw
 * away the `results` it returns, so every warning the commit modules produce
 * ("created without dedicated funding", "has no start year", "down-payment
 * account is no longer available") was invisible to the advisor.
 */
describe("ReviewWizard — commit warnings", () => {
  function stubFetchReturning(results: Record<string, { warnings: string[] }>) {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, results }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const payloadWithGoal = {
    ...emptyImportPayload(),
    goals: {
      education: [educationGoalFixture({ dedicatedAccountNames: [] })],
      homePurchases: [],
      riskTolerance: blank<string>(),
    },
  };

  it("surfaces the warnings the commit response returned for the tab it committed", async () => {
    stubFetchReturning({
      goals: {
        warnings: [
          'Could not find the funding account "Emma 529 Plan" for education goal "Emma — College" — the goal was created without dedicated funding.',
        ],
      },
    });

    render(<ReviewWizard {...baseProps} payload={payloadWithGoal} perTabCommittedAt={null} />);
    fireEvent.click(screen.getByRole("button", { name: /^Goals/ }));
    fireEvent.click(screen.getByRole("button", { name: /commit goals/i }));

    await waitFor(() =>
      expect(screen.getByText(/created without dedicated funding/i)).toBeInTheDocument(),
    );

    vi.unstubAllGlobals();
  });

  it("ignores warnings belonging to tabs this click did not commit", async () => {
    stubFetchReturning({
      goals: { warnings: [] },
      accounts: { warnings: ["An accounts warning from some earlier pass."] },
    });

    render(<ReviewWizard {...baseProps} payload={payloadWithGoal} perTabCommittedAt={null} />);
    fireEvent.click(screen.getByRole("button", { name: /^Goals/ }));
    fireEvent.click(screen.getByRole("button", { name: /commit goals/i }));

    await waitFor(() => expect(screen.queryByText(/committing/i)).not.toBeInTheDocument());
    expect(screen.queryByText(/from some earlier pass/i)).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("renders nothing extra when the commit returned no warnings", async () => {
    stubFetchReturning({ goals: { warnings: [] } });

    render(<ReviewWizard {...baseProps} payload={payloadWithGoal} perTabCommittedAt={null} />);
    fireEvent.click(screen.getByRole("button", { name: /^Goals/ }));
    fireEvent.click(screen.getByRole("button", { name: /commit goals/i }));

    await waitFor(() => expect(screen.queryByText(/committing/i)).not.toBeInTheDocument());
    expect(screen.queryByText(/warnings from the last commit/i)).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
