// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MicrosoftApprovalPage from "./page";

const APPROVED = "Microsoft 365 is approved for your organization. You can close this tab.";
const DECLINED = "Microsoft 365 wasn't approved. Whoever sent you this link can send it again.";
const EXPIRED = "This approval link has expired or was already used. Ask your Foundry admin for a new one.";

async function renderWith(searchParams: Record<string, string | string[] | undefined>) {
  render(await MicrosoftApprovalPage({ searchParams: Promise.resolve(searchParams) }));
}

describe("/microsoft-approval", () => {
  it.each([
    ["approved", APPROVED],
    ["declined", DECLINED],
    ["expired", EXPIRED],
  ])("result=%s renders its message", async (result, message) => {
    await renderWith({ result });
    expect(screen.getByText(message)).toBeTruthy();
    for (const other of [APPROVED, DECLINED, EXPIRED].filter((m) => m !== message)) {
      expect(screen.queryByText(other)).toBeNull();
    }
  });

  it.each([
    ["an unknown result", { result: "hacked" }],
    ["no result", {}],
    ["a repeated result", { result: ["approved", "declined"] }],
  ])("%s renders the expired message", async (_label, searchParams) => {
    await renderWith(searchParams);
    expect(screen.getByText(EXPIRED)).toBeTruthy();
    expect(screen.queryByText(APPROVED)).toBeNull();
  });
});
