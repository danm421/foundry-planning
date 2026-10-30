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

  it("(M6) a hidden chip says so aloud, not only by its strike-through", () => {
    bar([MS, GOOGLE], { hidden: new Set(["g-1"]) });
    // jsdom loads no CSS, so it reads the sr-only span as inline and drops its leading space; a browser keeps it.
    expect(screen.getByRole("button", { name: /^gmail ?\(hidden\)$/ })).toHaveClass("line-through");
    expect(screen.getByRole("button", { name: "foundryplanning" })).not.toHaveClass("line-through");
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

  /** Opens `+ Add account` and returns the panel it controls. */
  async function openAddAccount(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
    const trigger = screen.getByRole("button", { name: "+ Add account" });
    await user.click(trigger);
    const panel = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
    expect(panel).not.toBeNull();
    return panel!;
  }

  it("(M6) + Add account is a disclosure: the trigger says open or closed and names its panel, which is no menu", async () => {
    const user = userEvent.setup();
    bar([MS]);
    const trigger = screen.getByRole("button", { name: "+ Add account" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).not.toHaveAttribute("aria-haspopup");
    const panel = await openAddAccount(user);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(panel).not.toHaveAttribute("role");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
  });

  it("+ Add account lists Google and Microsoft 365 as plain links, with both help lines", async () => {
    const user = userEvent.setup();
    bar([MS]);
    const panel = await openAddAccount(user);
    expect(within(panel).getByRole("link", { name: "Google" })).toHaveAttribute("href", "/api/workspace/google/connect");
    expect(within(panel).getByRole("link", { name: "Microsoft 365" })).toHaveAttribute(
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
    const panel = await openAddAccount(user);
    expect(within(panel).getByText("Google")).toHaveAttribute("aria-disabled", "true");
    expect(within(panel).getByText("Microsoft 365")).toHaveAttribute("aria-disabled", "true");
    expect(within(panel).queryByRole("link")).toBeNull();
    expect(within(panel).getByText("5 addresses connected — the most Workspace allows.")).toBeInTheDocument();
  });

  it("googleEnabled=false: no Google item and no Google help", async () => {
    const user = userEvent.setup();
    bar([MS], { googleEnabled: false, googleClientId: null });
    await openAddAccount(user);
    expect(screen.queryByRole("link", { name: "Google" })).toBeNull();
    expect(screen.queryByText(/Google says your administrator/)).toBeNull();
    expect(screen.getByRole("link", { name: "Microsoft 365" })).toBeInTheDocument();
  });

  it("(M10) below md every panel hangs from the bar, so none runs off a phone screen", async () => {
    const user = userEvent.setup();
    bar([MS, GOOGLE]);
    const chip = screen.getByRole("button", { name: /^foundryplanning/ });
    const add = screen.getByRole("button", { name: "+ Add account" });
    // The bar is the panels' containing block below md; each trigger's wrapper only from md up.
    const barEl = chip.parentElement!.parentElement!;
    expect(barEl).toHaveClass("relative");
    for (const trigger of [chip, add]) {
      expect(trigger.parentElement).toHaveClass("md:relative");
      expect(trigger.parentElement).not.toHaveClass("relative");
    }
    await user.click(chip);
    expect(screen.getByRole("menu")).toHaveClass("absolute", "left-0", "top-full");
  });

  it("no itApprovalUrl: no Microsoft help line", async () => {
    const user = userEvent.setup();
    bar([MS], { itApprovalUrl: null });
    await user.click(screen.getByRole("button", { name: "+ Add account" }));
    expect(screen.queryByText(/Microsoft says your organization/)).toBeNull();
  });
});
