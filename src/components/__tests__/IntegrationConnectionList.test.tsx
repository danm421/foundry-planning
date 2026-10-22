// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntegrationConnectionList } from "../IntegrationConnectionList";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/components/toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const ETHOS = { id: "c-1", name: "Ethos", status: "connected" as const, lastSyncedAt: "2026-10-01T15:00:00Z", linkedHouseholds: 3 };

describe("IntegrationConnectionList", () => {
  it("shows Add another for BYOK, not OAuth", () => {
    const { unmount } = render(
      <IntegrationConnectionList providerId="addepar" label="Addepar" authKind="byok" connections={[ETHOS]} />,
    );
    expect(screen.getByRole("button", { name: "Add another Addepar connection" })).toBeInTheDocument();
    unmount();

    render(
      <IntegrationConnectionList providerId="orion" label="Orion" authKind="oauth" connections={[ETHOS]} />,
    );
    expect(screen.queryByRole("button", { name: /add another/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /connect orion/i })).toBeNull();
  });

  it("links each connection to its own page", () => {
    render(<IntegrationConnectionList providerId="addepar" label="Addepar" authKind="byok" connections={[ETHOS]} />);
    expect(screen.getByRole("link", { name: /Ethos/ })).toHaveAttribute("href", "/settings/integrations/addepar/c-1");
  });

  it("keeps the credential form hidden until Add another is pressed", async () => {
    const user = userEvent.setup();
    render(<IntegrationConnectionList providerId="addepar" label="Addepar" authKind="byok" connections={[ETHOS]} />);
    expect(screen.queryByLabelText(/api key/i)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Add another Addepar connection" }));

    expect(screen.getByLabelText(/api key/i)).toBeInTheDocument();
  });

  it("shows the form directly when there are no connections yet", () => {
    render(<IntegrationConnectionList providerId="addepar" label="Addepar" authKind="byok" connections={[]} />);
    expect(screen.getByLabelText(/api key/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add another/i })).toBeNull();
  });

  it("offers Connect for an OAuth provider with no connection", () => {
    render(<IntegrationConnectionList providerId="orion" label="Orion" authKind="oauth" connections={[]} />);
    expect(screen.getByRole("link", { name: "Connect Orion" })).toHaveAttribute("href", "/api/integrations/orion/connect");
  });
});
