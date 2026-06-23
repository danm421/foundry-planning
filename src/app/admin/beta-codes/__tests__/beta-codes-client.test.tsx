// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The client imports the server action from `./actions`, which pulls in
// clerk/db/audit. Mock it so the component renders in jsdom and we can assert
// the exact payload the mint form submits.
vi.mock("../actions", () => ({
  mintCodesAction: vi.fn(async () => ({ ok: true, codes: ["FNDR-AAAA-BBBB"] })),
  revokeCodeAction: vi.fn(async () => ({ ok: true })),
}));

import BetaCodesClient, { type CodeRow } from "../beta-codes-client";
import { mintCodesAction } from "../actions";
import type { CapabilityKey } from "@/lib/ops/entitlements";

const CAPABILITIES: CapabilityKey[] = [
  {
    key: "ai_import",
    label: "AI document import",
    description: "Extract client data from uploaded documents via AI.",
  },
  {
    key: "ai_forge",
    label: "Forge (AI planning assistant)",
    description: "Conversational planning assistant powered by AI agents.",
  },
];

function makeCode(over: Partial<CodeRow> = {}): CodeRow {
  return {
    id: "c1",
    label: "Jane @ Acme",
    entitlements: ["ai_import"],
    status: "unused",
    createdAt: "2026-06-22T00:00:00.000Z",
    expiresAt: null,
    redeemedByUserId: null,
    redeemedOrgId: null,
    ...over,
  };
}

describe("BetaCodesClient", () => {
  beforeEach(() => {
    vi.mocked(mintCodesAction).mockClear();
  });

  it("offers Forge as a checkbox option with ai_import checked by default", () => {
    render(<BetaCodesClient initialCodes={[]} capabilities={CAPABILITIES} />);

    const importBox = screen.getByRole("checkbox", { name: /AI document import/ });
    const forgeBox = screen.getByRole("checkbox", { name: /Forge \(AI planning assistant\)/ });

    expect(importBox).toBeChecked();
    expect(forgeBox).not.toBeChecked();
  });

  it("submits the selected entitlement keys (including Forge) to the action", async () => {
    const user = userEvent.setup();
    render(<BetaCodesClient initialCodes={[]} capabilities={CAPABILITIES} />);

    await user.click(screen.getByRole("checkbox", { name: /Forge/ }));
    await user.click(screen.getByRole("button", { name: /Mint codes/ }));

    await waitFor(() => expect(mintCodesAction).toHaveBeenCalledTimes(1));
    expect(mintCodesAction).toHaveBeenCalledWith(
      expect.objectContaining({ entitlements: ["ai_import", "ai_forge"] }),
    );
  });

  it("disables minting when no entitlement is selected", async () => {
    const user = userEvent.setup();
    render(<BetaCodesClient initialCodes={[]} capabilities={CAPABILITIES} />);

    // Uncheck the only selected option → empty grant.
    await user.click(screen.getByRole("checkbox", { name: /AI document import/ }));

    expect(screen.getByRole("button", { name: /Mint codes/ })).toBeDisabled();
    expect(screen.getByText("Select at least one entitlement.")).toBeInTheDocument();
  });

  it("renders each code's entitlements as labels, falling back to the raw key", () => {
    render(
      <BetaCodesClient
        initialCodes={[
          makeCode({ id: "c1", entitlements: ["ai_import", "ai_forge"] }),
          makeCode({ id: "c2", label: "Legacy", entitlements: ["ai_copilot"] }),
        ]}
        capabilities={CAPABILITIES}
      />,
    );

    const table = within(screen.getByRole("table"));
    // Known keys render their human labels...
    expect(table.getByText("AI document import")).toBeInTheDocument();
    expect(table.getByText("Forge (AI planning assistant)")).toBeInTheDocument();
    // ...unknown/legacy keys fall back to the raw key so nothing renders blank.
    expect(table.getByText("ai_copilot")).toBeInTheDocument();
  });
});
