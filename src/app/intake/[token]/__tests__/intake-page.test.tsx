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

vi.mock("@/lib/branding/branding", () => ({
  resolveIntakeBranding: vi.fn(),
}));

// ─── Mock IntakeClient so the branching test stays pure ─────────────────────

vi.mock("../intake-client", () => ({
  IntakeClient: ({
    token,
    recipientName,
    branding,
  }: {
    token: string;
    recipientName: string | null;
    initialPayload: unknown;
    branding: { firmName: string } | null;
  }) => (
    <div data-testid="intake-client">
      <span data-testid="token">{token}</span>
      <span data-testid="recipient">{recipientName ?? "anonymous"}</span>
      <span data-testid="branding">{branding?.firmName ?? "none"}</span>
    </div>
  ),
}));

// ─── Import after mocks are registered ───────────────────────────────────────

import { loadFormByToken } from "@/lib/intake/queries";
import { isExpired } from "@/lib/intake/tokens";
import { resolveIntakeBranding } from "@/lib/branding/branding";
import IntakePage, { generateMetadata } from "../page";

const mockLoadFormByToken = vi.mocked(loadFormByToken);
const mockIsExpired = vi.mocked(isExpired);
const mockResolveIntakeBranding = vi.mocked(resolveIntakeBranding);

const ACME_BRANDING = {
  logoUrl: "https://cdn.example/logo.png",
  firmName: "Acme Wealth",
  faviconUrl: "https://cdn.example/fav.png",
};

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

  it("passes firm branding to the client wrapper when the firm has a logo", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockLoadFormByToken.mockResolvedValue(makeForm() as any);
    mockIsExpired.mockReturnValue(false);
    mockResolveIntakeBranding.mockResolvedValue(ACME_BRANDING);

    render(await IntakePage({ params: makeParams() }));

    expect(screen.getByTestId("branding")).toHaveTextContent("Acme Wealth");
    expect(mockResolveIntakeBranding).toHaveBeenCalledWith("firm-1");
  });

  it("renders the Foundry lockup on the expired state for an unknown token", async () => {
    mockLoadFormByToken.mockResolvedValue(null);

    render(await IntakePage({ params: makeParams() }));

    expect(
      screen.getByRole("img", { name: "Foundry Planning" }),
    ).toBeInTheDocument();
    expect(mockResolveIntakeBranding).not.toHaveBeenCalled();
  });

  it("shows the firm letterhead on the expired state when the form is known", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockLoadFormByToken.mockResolvedValue(makeForm() as any);
    mockIsExpired.mockReturnValue(true);
    mockResolveIntakeBranding.mockResolvedValue(ACME_BRANDING);

    render(await IntakePage({ params: makeParams() }));

    expect(screen.getByRole("img", { name: "Acme Wealth" })).toBeInTheDocument();
  });
});

describe("generateMetadata", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns firm title and favicon for a branded firm", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockLoadFormByToken.mockResolvedValue(makeForm() as any);
    mockResolveIntakeBranding.mockResolvedValue(ACME_BRANDING);

    const meta = await generateMetadata({ params: makeParams() });

    expect(meta.title).toBe("Acme Wealth — Client information form");
    expect(meta.icons).toEqual({ icon: "https://cdn.example/fav.png" });
  });

  it("returns empty metadata for an unknown token or unbranded firm", async () => {
    mockLoadFormByToken.mockResolvedValue(null);
    expect(await generateMetadata({ params: makeParams() })).toEqual({});

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockLoadFormByToken.mockResolvedValue(makeForm() as any);
    mockResolveIntakeBranding.mockResolvedValue(null);
    expect(await generateMetadata({ params: makeParams() })).toEqual({});
  });
});
