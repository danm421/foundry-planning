// @vitest-environment jsdom
/**
 * The Notes tab saves through `useScenarioWriter` (the REAL hook; `?scenario=`
 * comes from the mocked search params). R1: in a scenario the only request is a
 * scenario change — never a `/notes` call or an account PUT. R3: base keeps PUT.
 */
import { act, render, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let scenarioParam = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/clients/c1/solver",
  useSearchParams: () => new URLSearchParams(scenarioParam ? `scenario=${scenarioParam}` : ""),
}));

import BusinessNotesTab from "../notes-tab";
import type { BusinessAccount } from "../types";

const BIZ = "22222222-2222-4222-8222-222222222222";
const business = { id: BIZ, name: "Acme", category: "business", notes: "old" } as unknown as BusinessAccount;

const fetchMock = vi.fn();
const calls = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    url: url as string,
    method: (init as RequestInit).method,
    body: JSON.parse((init as RequestInit).body as string),
  }));

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function editAndBlur() {
  render(<BusinessNotesTab clientId="c1" business={business} hidden={false} />);
  const area = document.getElementById("biz-notes")!;
  fireEvent.change(area, { target: { value: "new notes" } });
  await act(async () => {
    fireEvent.blur(area);
  });
}

describe("BusinessNotesTab", () => {
  it("in a scenario, saves notes as ONE scenario edit and nothing else", async () => {
    scenarioParam = "sc1";
    await editAndBlur();

    expect(calls()).toEqual([
      {
        url: "/api/clients/c1/scenarios/sc1/changes",
        method: "POST",
        body: { op: "edit", targetKind: "account", targetId: BIZ, desiredFields: { notes: "new notes" } },
      },
    ]);
  });

  it("in base mode, still PUTs the account", async () => {
    scenarioParam = "";
    await editAndBlur();

    expect(calls()).toEqual([
      { url: `/api/clients/c1/accounts/${BIZ}`, method: "PUT", body: { notes: "new notes" } },
    ]);
  });
});
