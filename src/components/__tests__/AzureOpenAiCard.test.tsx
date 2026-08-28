// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AzureOpenAiCard } from "../AzureOpenAiCard";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

function fill() {
  fireEvent.change(screen.getByLabelText(/Azure endpoint/i), {
    target: { value: "https://acme-ria.openai.azure.com" },
  });
  fireEvent.change(screen.getByLabelText(/API key/i), { target: { value: "firm-key" } });
}

/**
 * Real assertion for "Foundry never stands alone" (R29 / constraint 8):
 * collects every bare "Foundry" occurrence in the rendered text — one not
 * preceded by "Microsoft " (Azure's portal) or followed by " Planning" (our
 * product) — and returns them with surrounding context. A caller asserts
 * `toEqual([])`, so a failure names the offending snippet instead of a loop
 * whose body never checks its own match.
 */
function foundryViolations(text: string): string[] {
  const violations: string[] = [];
  const re = /Foundry/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const start = match.index;
    const before = text.slice(Math.max(0, start - 10), start);
    const after = text.slice(start + "Foundry".length, start + "Foundry".length + 9);
    const qualified = before.endsWith("Microsoft ") || after.startsWith(" Planning");
    if (!qualified) {
      violations.push(text.slice(Math.max(0, start - 20), start + 30));
    }
  }
  return violations;
}

describe("AzureOpenAiCard — disconnected", () => {
  it("shows the Azure setup steps", () => {
    render(<AzureOpenAiCard status="disconnected" endpoint={null} chatDeployment={null} connectedAt={null} />);
    expect(screen.getByText(/Set up in Azure/i)).toBeTruthy();
  });

  it("warns that zero data retention is not available on pay-as-you-go", () => {
    render(<AzureOpenAiCard status="disconnected" endpoint={null} chatDeployment={null} connectedAt={null} />);
    expect(screen.getByText(/pay-as-you-go/i)).toBeTruthy();
  });

  it("names Azure's portal as Microsoft Foundry on first use", () => {
    render(<AzureOpenAiCard status="disconnected" endpoint={null} chatDeployment={null} connectedAt={null} />);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/Microsoft Foundry \(Azure/);
  });

  it("never lets 'Foundry' stand alone anywhere in the card", () => {
    const { container } = render(
      <AzureOpenAiCard status="disconnected" endpoint={null} chatDeployment={null} connectedAt={null} />,
    );
    expect(foundryViolations(container.textContent ?? "")).toEqual([]);
  });

  it("keeps Connect disabled until a test passes", async () => {
    render(<AzureOpenAiCard status="disconnected" endpoint={null} chatDeployment={null} connectedAt={null} />);
    fill();
    expect(screen.getByRole("button", { name: /^Connect$/i })).toHaveProperty("disabled", true);

    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, checks: [] }) });
    fireEvent.click(screen.getByRole("button", { name: /Test connection/i }));
    fireEvent.click(screen.getByLabelText(/I understand/i));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Connect$/i })).toHaveProperty("disabled", false),
    );
  });

  it("invalidates a passed test when a credential changes", async () => {
    render(<AzureOpenAiCard status="disconnected" endpoint={null} chatDeployment={null} connectedAt={null} />);
    fill();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, checks: [] }) });
    fireEvent.click(screen.getByRole("button", { name: /Test connection/i }));
    fireEvent.click(screen.getByLabelText(/I understand/i));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Connect$/i })).toHaveProperty("disabled", false),
    );

    fireEvent.change(screen.getByLabelText(/API key/i), { target: { value: "different" } });

    expect(screen.getByRole("button", { name: /^Connect$/i })).toHaveProperty("disabled", true);
  });

  it("shows each failed check by name", async () => {
    render(<AzureOpenAiCard status="disconnected" endpoint={null} chatDeployment={null} connectedAt={null} />);
    fill();
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({
        ok: false,
        checks: [
          { name: "chat", ok: true },
          { name: "mini", ok: true },
          { name: "embedding", ok: false, detail: "different model from the planning library" },
        ],
      }),
    });
    fireEvent.click(screen.getByRole("button", { name: /Test connection/i }));

    await waitFor(() => expect(screen.getByText(/different model/i)).toBeTruthy());
  });
});

describe("AzureOpenAiCard — connected", () => {
  const props = {
    status: "connected" as const,
    endpoint: "https://acme-ria.openai.azure.com",
    chatDeployment: "gpt-5.4",
    connectedAt: "2026-08-27T12:00:00.000Z",
  };

  it("states plainly that AI runs in the firm's own tenant", () => {
    render(<AzureOpenAiCard {...props} />);
    expect(screen.getByText(/runs in your own Azure tenant/i)).toBeTruthy();
  });

  it("shows the endpoint and deployment but no key field", () => {
    render(<AzureOpenAiCard {...props} />);
    expect(screen.getByText(/acme-ria\.openai\.azure\.com/)).toBeTruthy();
    expect(screen.queryByLabelText(/API key/i)).toBeNull();
  });

  it("says connecting is not retroactive", () => {
    render(<AzureOpenAiCard {...props} />);
    expect(screen.getByText(/does not move work already done/i)).toBeTruthy();
  });

  it("never lets 'Foundry' stand alone anywhere in the card", () => {
    const { container } = render(<AzureOpenAiCard {...props} />);
    expect(foundryViolations(container.textContent ?? "")).toEqual([]);
  });
});

describe("AzureOpenAiCard — error", () => {
  const props = {
    status: "error" as const,
    endpoint: "https://acme-ria.openai.azure.com",
    chatDeployment: "gpt-5.4",
    connectedAt: "2026-08-27T12:00:00.000Z",
  };

  it("shows a reconnect-needed status and that AI features are paused", () => {
    render(<AzureOpenAiCard {...props} />);
    expect(screen.getByText(/Reconnect needed/i)).toBeTruthy();
    expect(screen.getByText(/AI features are paused/i)).toBeTruthy();
  });

  it("promises no fallback to Foundry Planning's own AI", () => {
    render(<AzureOpenAiCard {...props} />);
    expect(screen.getByText(/will not fall back to Foundry Planning/i)).toBeTruthy();
  });

  it("never lets 'Foundry' stand alone anywhere in the card", () => {
    const { container } = render(<AzureOpenAiCard {...props} />);
    expect(foundryViolations(container.textContent ?? "")).toEqual([]);
  });
});
