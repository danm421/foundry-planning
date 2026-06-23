// @vitest-environment jsdom
/**
 * Tests for the /intake/[token] server page branching.
 *
 * Strategy: mock `loadFormByToken` and `isExpired` so we can exercise the
 * server-component branching logic without a live DB. We also mock IntakeClient
 * (the "use client" wrapper) to keep this a pure branching test — the client
 * wrapper is covered by intake-client.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ─── Mock loadFormByToken + isExpired ─────────────────────────────────────────

vi.mock("@/lib/intake/queries", () => ({
  loadFormByToken: vi.fn(),
}));

vi.mock("@/lib/intake/tokens", () => ({
  isExpired: vi.fn(),
}));

// ─── Mock IntakeClient so the branching test stays pure ─────────────────────

vi.mock("../intake-client", () => ({
  IntakeClient: ({
    token,
    recipientName,
  }: {
    token: string;
    recipientName: string | null;
    initialPayload: unknown;
  }) => (
    <div data-testid="intake-client">
      <span data-testid="token">{token}</span>
      <span data-testid="recipient">{recipientName ?? "anonymous"}</span>
    </div>
  ),
}));

// ─── Import after mocks are registered ───────────────────────────────────────

import { loadFormByToken } from "@/lib/intake/queries";
import { isExpired } from "@/lib/intake/tokens";
import IntakePage from "../page";

const mockLoadFormByToken = vi.mocked(loadFormByToken);
const mockIsExpired = vi.mocked(isExpired);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TOKEN = "tok_test_abc123";

function makeParams(token: string = TOKEN) {
  return Promise.resolve({ token });
}

function makeForm(
  overrides: Partial<{
    status: string;
    expiresAt: Date;
    recipientName: string | null;
    payload: unknown;
  }> = {},
) {
  return {
    id: "form-1",
    firmId: "firm-1",
    clientId: null,
    mode: "blank",
    status: "draft",
    token: TOKEN,
    recipientEmail: "client@example.com",
    recipientName: "Jane Client",
    payload: {},
    createdByUserId: "user-1",
    sentAt: null,
    submittedAt: null,
    appliedAt: null,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("IntakePage server component branching", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("renders ExpiredLink when loadFormByToken returns null (missing token)", async () => {
    mockLoadFormByToken.mockResolvedValue(null);

    const jsx = await IntakePage({ params: makeParams() });
    render(jsx);

    expect(screen.getByRole("heading", { name: /no longer active/i })).toBeInTheDocument();
    expect(screen.queryByTestId("intake-client")).not.toBeInTheDocument();
  });

  it("renders ExpiredLink when the form is expired", async () => {
    const expiredForm = makeForm({
      expiresAt: new Date(Date.now() - 1000),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockLoadFormByToken.mockResolvedValue(expiredForm as any);
    mockIsExpired.mockReturnValue(true);

    const jsx = await IntakePage({ params: makeParams() });
    render(jsx);

    expect(screen.getByText(/link expired/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /no longer active/i })).toBeInTheDocument();
    expect(screen.queryByTestId("intake-client")).not.toBeInTheDocument();
  });

  it("renders ThankYou when the form status is 'submitted'", async () => {
    const submittedForm = makeForm({
      status: "submitted",
      recipientName: "Jane Client",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockLoadFormByToken.mockResolvedValue(submittedForm as any);
    mockIsExpired.mockReturnValue(false);

    const jsx = await IntakePage({ params: makeParams() });
    render(jsx);

    expect(screen.getByRole("heading", { name: /thank you, jane client/i })).toBeInTheDocument();
    expect(screen.queryByTestId("intake-client")).not.toBeInTheDocument();
  });

  it("renders ThankYou when the form status is 'applied'", async () => {
    const appliedForm = makeForm({ status: "applied", recipientName: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockLoadFormByToken.mockResolvedValue(appliedForm as any);
    mockIsExpired.mockReturnValue(false);

    const jsx = await IntakePage({ params: makeParams() });
    render(jsx);

    expect(screen.getByRole("heading", { name: /thank you\./i })).toBeInTheDocument();
    expect(screen.queryByTestId("intake-client")).not.toBeInTheDocument();
  });

  it("renders IntakeClient for an active draft, passing token + recipientName (no plan data)", async () => {
    const draftForm = makeForm({
      status: "draft",
      recipientName: "Jane Client",
      payload: { family: { primary: { firstName: "Jane" } } },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockLoadFormByToken.mockResolvedValue(draftForm as any);
    mockIsExpired.mockReturnValue(false);

    const jsx = await IntakePage({ params: makeParams() });
    render(jsx);

    expect(screen.getByTestId("intake-client")).toBeInTheDocument();
    expect(screen.getByTestId("token")).toHaveTextContent(TOKEN);
    expect(screen.getByTestId("recipient")).toHaveTextContent("Jane Client");
    expect(screen.queryByRole("heading", { name: /no longer active/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /thank you/i })).not.toBeInTheDocument();
  });

  it("renders IntakeClient for a draft with no recipientName (null)", async () => {
    const draftForm = makeForm({ status: "draft", recipientName: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockLoadFormByToken.mockResolvedValue(draftForm as any);
    mockIsExpired.mockReturnValue(false);

    const jsx = await IntakePage({ params: makeParams() });
    render(jsx);

    expect(screen.getByTestId("intake-client")).toBeInTheDocument();
    expect(screen.getByTestId("recipient")).toHaveTextContent("anonymous");
  });
});
