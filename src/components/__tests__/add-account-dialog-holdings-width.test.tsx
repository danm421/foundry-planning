// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import AddAccountDialog from "../add-account-dialog";
import type { AccountFormInitial } from "../forms/add-account-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/client-1",
}));

const EDITING: AccountFormInitial = {
  id: "acct-1",
  name: "Fidelity Brokerage",
  category: "taxable",
  subType: "brokerage",
  owner: "client",
  value: "100000",
  basis: "80000",
  growthRate: "0.07",
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] })));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** The Holdings grid needs ~832px before it scrolls sideways; the rest of the
 *  form is built for the 640px default. The surface follows the visible tab. */
describe("account dialog width", () => {
  it("opens wide on the Holdings tab", async () => {
    render(<AddAccountDialog clientId="client-1" open editing={EDITING} initialTab="holdings" />);
    await waitFor(() =>
      expect(screen.getByRole("dialog").className).toContain("max-w-[1120px]"),
    );
  });

  it("stays at the default width on every other tab", async () => {
    render(<AddAccountDialog clientId="client-1" open editing={EDITING} initialTab="details" />);
    await waitFor(() => expect(screen.getByRole("dialog").className).toContain("max-w-[640px]"));
    expect(screen.getByRole("dialog").className).not.toContain("max-w-[1120px]");
  });
});
