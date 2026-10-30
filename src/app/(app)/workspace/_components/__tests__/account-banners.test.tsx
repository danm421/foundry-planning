// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountSummary } from "@/lib/workspace/types";
import { AccountBanners } from "../account-banners";

const GOOGLE: AccountSummary = {
  id: "g-1",
  provider: "google",
  email: "dan@gmail.com",
  status: "connected",
  connectedAt: "2026-10-01T00:00:00.000Z",
};
const MS: AccountSummary = { ...GOOGLE, id: "m-1", provider: "microsoft", email: "dan@firm.com" };

describe("AccountBanners", () => {
  it("a throttled Google account says busy, with Retry", async () => {
    const onRetry = vi.fn();
    render(
      <AccountBanners
        accounts={[GOOGLE]}
        results={[{ connectionId: "g-1", error: "throttled" }]}
        hidden={new Set()}
        onRetry={onRetry}
      />,
    );
    expect(
      screen.getByText("Google is busy — dan@gmail.com's meetings aren't shown. Try again in a minute."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("needs_reconnect names the address and links Reconnect to its provider", () => {
    render(
      <AccountBanners
        accounts={[MS]}
        results={[{ connectionId: "m-1", error: "needs_reconnect" }]}
        hidden={new Set()}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText("dan@firm.com needs to reconnect.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reconnect" })).toHaveAttribute(
      "href",
      "/api/workspace/microsoft/connect?hint=dan%40firm.com",
    );
  });

  it("unavailable reads Couldn't load, with Retry", () => {
    render(
      <AccountBanners
        accounts={[MS]}
        results={[{ connectionId: "m-1", error: "unavailable" }]}
        hidden={new Set()}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText("Couldn't load dan@firm.com's meetings.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("a hidden account's error renders nothing; healthy accounts render nothing", () => {
    const { container } = render(
      <AccountBanners
        accounts={[GOOGLE, MS]}
        results={[
          { connectionId: "g-1", error: "throttled" },
          { connectionId: "m-1", error: null },
        ]}
        hidden={new Set(["g-1"])}
        onRetry={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
