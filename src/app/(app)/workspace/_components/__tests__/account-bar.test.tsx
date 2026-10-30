// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountSummary } from "@/lib/workspace/types";
import { AccountBar } from "../account-bar";

const acct = (over: Partial<AccountSummary> & Pick<AccountSummary, "id" | "email">): AccountSummary => ({
  provider: "microsoft",
  status: "connected",
  connectedAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

const MS = acct({ id: "ms-1", email: "dan@foundryplanning.com" });
const GOOGLE = acct({ id: "g-1", email: "dan@gmail.com", provider: "google" });

function bar(accounts: AccountSummary[], over: Partial<Parameters<typeof AccountBar>[0]> = {}) {
  const labels = new Map(accounts.map((a) => [a.id, a.email.split("@")[1].split(".")[0]]));
  const props = {
    accounts,
    labels: accounts.length >= 2 ? labels : null,
    hidden: new Set<string>(),
    onToggleHidden: vi.fn(),
    onDisconnect: vi.fn(),
    googleEnabled: true,
    itApprovalUrl: "https://login.example/adminconsent?x=1",
    googleClientId: "client-123.apps.googleusercontent.com",
    ...over,
  };
  render(<AccountBar {...props} />);
  return props;
}

describe("AccountBar", () => {
  it("one account: the Connected as line, no chips", () => {
    bar([MS]);
    expect(screen.getByText(/Connected as/)).toHaveTextContent("Connected as dan@foundryplanning.com");
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(foundryplanning|gmail)/ })).toBeNull();
    expect(screen.getByRole("button", { name: "+ Add account" })).toBeInTheDocument();
  });

  it("one account: Disconnect asks the page to disconnect it", async () => {
    const p = bar([MS]);
    await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(p.onDisconnect).toHaveBeenCalledWith(MS);
  });

  it("two accounts: a chip each, labelled, no Connected as line", () => {
    bar([MS, GOOGLE]);
    expect(screen.getByRole("button", { name: /foundryplanning/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /gmail/ })).toBeInTheDocument();
    expect(screen.queryByText(/Connected as/)).toBeNull();
  });

  it("a chip's menu hides, shows and disconnects", async () => {
    const user = userEvent.setup();
    const p = bar([MS, GOOGLE], { hidden: new Set(["g-1"]) });
    await user.click(screen.getByRole("button", { name: /foundryplanning/ }));
    await user.click(screen.getByRole("menuitem", { name: "Hide" }));
    expect(p.onToggleHidden).toHaveBeenCalledWith("ms-1");
    await user.click(screen.getByRole("button", { name: /gmail/ }));
    expect(screen.getByRole("menuitem", { name: "Show" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Reconnect" })).toBeNull();
    await user.click(screen.getByRole("menuitem", { name: "Disconnect" }));
    expect(p.onDisconnect).toHaveBeenCalledWith(GOOGLE);
  });

  it("a needs_reconnect chip's menu has Reconnect to that provider's connect route", async () => {
    const user = userEvent.setup();
    bar([MS, { ...GOOGLE, status: "needs_reconnect" }]);
    await user.click(screen.getByRole("button", { name: /gmail/ }));
    expect(screen.getByRole("menuitem", { name: "Reconnect" })).toHaveAttribute(
      "href",
      "/api/workspace/google/connect?hint=dan%40gmail.com",
    );
  });

  it("+ Add account lists Google and Microsoft 365 as plain links, with both help lines", async () => {
    const user = userEvent.setup();
    bar([MS]);
    await user.click(screen.getByRole("button", { name: "+ Add account" }));
    expect(screen.getByRole("menuitem", { name: "Google" })).toHaveAttribute("href", "/api/workspace/google/connect");
    expect(screen.getByRole("menuitem", { name: "Microsoft 365" })).toHaveAttribute(
      "href",
      "/api/workspace/microsoft/connect",
    );
    expect(
      screen.getByText("Microsoft says your organization must approve Foundry? Send this link to your IT admin."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Google says your administrator blocks Foundry\?/)).toBeInTheDocument();
    expect(screen.getByText("client-123.apps.googleusercontent.com")).toBeInTheDocument();
  });

  it("Copy link and Copy put the approval link and client id on the clipboard", async () => {
    const user = userEvent.setup();
    bar([MS]);
    await user.click(screen.getByRole("button", { name: "+ Add account" }));
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenLastCalledWith("https://login.example/adminconsent?x=1");
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenLastCalledWith("client-123.apps.googleusercontent.com");
  });

  it("at 5 accounts the add items are disabled and the cap line shows", async () => {
    const user = userEvent.setup();
    const five = ["a", "b", "c", "d", "e"].map((x, i) =>
      acct({ id: `id-${i}`, email: `dan@${x}.com`, provider: i % 2 ? "google" : "microsoft" }),
    );
    bar(five);
    await user.click(screen.getByRole("button", { name: "+ Add account" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Google" })).toHaveAttribute("aria-disabled", "true");
    expect(within(menu).getByRole("menuitem", { name: "Microsoft 365" })).toHaveAttribute("aria-disabled", "true");
    expect(within(menu).getByRole("menuitem", { name: "Google" })).not.toHaveAttribute("href");
    expect(within(menu).getByText("5 addresses connected — the most Workspace allows.")).toBeInTheDocument();
  });

  it("googleEnabled=false: no Google item and no Google help", async () => {
    const user = userEvent.setup();
    bar([MS], { googleEnabled: false, googleClientId: null });
    await user.click(screen.getByRole("button", { name: "+ Add account" }));
    expect(screen.queryByRole("menuitem", { name: "Google" })).toBeNull();
    expect(screen.queryByText(/Google says your administrator/)).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Microsoft 365" })).toBeInTheDocument();
  });

  it("no itApprovalUrl: no Microsoft help line", async () => {
    const user = userEvent.setup();
    bar([MS], { itApprovalUrl: null });
    await user.click(screen.getByRole("button", { name: "+ Add account" }));
    expect(screen.queryByText(/Microsoft says your organization/)).toBeNull();
  });
});
