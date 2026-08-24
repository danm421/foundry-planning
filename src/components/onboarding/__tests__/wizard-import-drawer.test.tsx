// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import WizardImportDrawer from "../wizard-import-drawer";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

// The review pane fetches canonical rows and renders every review step — out of
// scope here. This test is about the drawer's stage machine.
vi.mock("../wizard-import-review", () => ({
  default: () => <div data-testid="review-pane">review</div>,
}));

vi.mock("@/components/import/upload-zone", () => ({
  default: () => <div data-testid="upload-zone">dropzone</div>,
}));

/** An import whose payload carries one account, i.e. data for the Assets step. */
function accountsPayload() {
  return {
    primary: undefined,
    spouse: undefined,
    dependents: [],
    accounts: [{ name: "Fidelity Brokerage" }],
    incomes: [],
    expenses: [],
    liabilities: [],
    lifePolicies: [],
    wills: [],
    entities: [],
    savings: [],
    warnings: [],
  };
}

const baseProps = {
  clientId: "c1",
  step: "accounts" as const,
  baseScenarioId: "s1",
  activeImportId: "imp1",
  onClose: vi.fn(),
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).endsWith("/imports/imp1")) {
        return {
          ok: true,
          json: async () => ({
            import: {
              status: "review",
              payloadJson: { payload: accountsPayload() },
              perTabCommittedAt: null,
            },
            files: [{ id: "f1", originalFilename: "statement.pdf" }],
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WizardImportDrawer", () => {
  it("opens on review when the shared draft already has data for this step", async () => {
    render(<WizardImportDrawer {...baseProps} />);
    expect(await screen.findByTestId("review-pane")).toBeInTheDocument();
  });

  // The reported bug: reopening the drawer after an extraction dropped the
  // advisor on the review pane with no way back to the dropzone.
  it("offers a way back to upload from the review pane", async () => {
    render(<WizardImportDrawer {...baseProps} />);
    const add = await screen.findByRole("button", {
      name: /add another document/i,
    });
    fireEvent.click(add);

    expect(await screen.findByTestId("upload-zone")).toBeInTheDocument();
    expect(screen.queryByTestId("review-pane")).toBeNull();
    // The documents already read stay visible so the advisor knows what's there.
    expect(screen.getByText("statement.pdf")).toBeInTheDocument();
  });

  it("returns to the review pane without re-extracting", async () => {
    render(<WizardImportDrawer {...baseProps} />);
    fireEvent.click(
      await screen.findByRole("button", { name: /add another document/i }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /back to review/i }),
    );

    expect(await screen.findByTestId("review-pane")).toBeInTheDocument();
    const calls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("/extract"))).toBe(false);
  });

  it("only sends the unread documents to the model on a re-extract", async () => {
    render(<WizardImportDrawer {...baseProps} />);
    fireEvent.click(
      await screen.findByRole("button", { name: /add another document/i }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /extract new documents/i }),
    );

    await waitFor(() => {
      const extractCall = vi
        .mocked(fetch)
        .mock.calls.find((c) => String(c[0]).includes("/extract"));
      expect(extractCall).toBeDefined();
      const body = JSON.parse(
        (extractCall![1] as RequestInit).body as string,
      ) as { skipExtracted?: boolean };
      expect(body.skipExtracted).toBe(true);
    });
  });
});
