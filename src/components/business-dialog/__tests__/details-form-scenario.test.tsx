// @vitest-environment jsdom
/**
 * The business details form writes through `useScenarioWriter` (the REAL hook
 * here, with the URL's `?scenario=` driven by the mocked search params).
 *
 * R1: inside a scenario the WHOLE request list is scenario changes — never a
 * bare `/accounts` PUT/POST. R3: in base mode the existing REST call is kept.
 */
import { createRef } from "react";
import { act, render, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let scenarioParam = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/clients/c1/solver",
  useSearchParams: () => new URLSearchParams(scenarioParam ? `scenario=${scenarioParam}` : ""),
}));

import BusinessDetailsForm from "../details-form";
import type { BusinessAccount, BusinessFormAutoSaveHandle } from "../types";

const FM = "11111111-1111-4111-8111-111111111111";
const BIZ = "22222222-2222-4222-8222-222222222222";
const SCENARIO_URL = "/api/clients/c1/scenarios/sc1/changes";
const OWNERS = [{ kind: "family_member", familyMemberId: FM, percent: 1 }];

const fetchMock = vi.fn();
const calls = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    url: url as string,
    method: (init as RequestInit).method,
    body: (init as RequestInit).body ? JSON.parse((init as RequestInit).body as string) : undefined,
  }));

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (_url: string, init: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => ({ ...JSON.parse(init.body as string), id: BIZ }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  scenarioParam = "sc1";
});
afterEach(() => vi.unstubAllGlobals());

const EXISTING = {
  id: BIZ,
  name: "Acme LLC",
  category: "business",
  subType: "llc",
  value: 500000,
  basis: 100000,
  growthRate: null,
  growthSource: "default",
  businessType: "llc",
  businessTaxTreatment: "qbi",
  distributionPolicyPercent: null,
  owners: OWNERS,
  parentAccountId: null,
} as unknown as BusinessAccount;

function renderForm(editing?: BusinessAccount) {
  const ref = createRef<BusinessFormAutoSaveHandle>();
  const onAutoSaved = vi.fn();
  render(
    <BusinessDetailsForm
      ref={ref}
      clientId="c1"
      editing={editing}
      activeTab="details"
      familyMembers={[{ id: FM, role: "client", firstName: "Alice" }]}
      entities={[]}
      onSaved={vi.fn()}
      onAutoSaved={onAutoSaved}
      onClose={vi.fn()}
    />,
  );
  return { ref, onAutoSaved };
}

const type = (id: string, value: string) =>
  fireEvent.change(document.getElementById(id)!, { target: { value } });

describe("BusinessDetailsForm — scenario mode", () => {
  it("an edit posts ONE scenario change and nothing else", async () => {
    const { ref } = renderForm(EXISTING);
    type("biz-name", "Acme Holdings");
    type("biz-distpct", "40");

    let result: Awaited<ReturnType<BusinessFormAutoSaveHandle["saveAsync"]>> | undefined;
    await act(async () => {
      result = await ref.current!.saveAsync();
    });

    expect(result?.ok).toBe(true);
    const list = calls();
    expect(list).toHaveLength(1);
    expect(list[0].url).toBe(SCENARIO_URL);
    expect(list[0].method).toBe("POST");
    expect(list[0].body).toMatchObject({
      op: "edit",
      targetKind: "account",
      targetId: BIZ,
      desiredFields: {
        name: "Acme Holdings",
        businessType: "llc",
        businessTaxTreatment: "qbi",
        distributionPolicyPercent: 0.4,
        growthSource: "default",
      },
    });
    // A blank growth rate is OMITTED, not sent as null.
    expect("growthRate" in list[0].body.desiredFields).toBe(false);
  });

  it("an add posts the business and its default-checking child as two scenario adds", async () => {
    const { ref } = renderForm();
    type("biz-name", "New Co");
    type("biz-value", "250000");

    let result: Awaited<ReturnType<BusinessFormAutoSaveHandle["saveAsync"]>> | undefined;
    await act(async () => {
      result = await ref.current!.saveAsync();
    });

    expect(result?.ok).toBe(true);
    const list = calls();
    expect(list.map((c) => c.url)).toEqual([SCENARIO_URL, SCENARIO_URL]);
    expect(list.map((c) => c.method)).toEqual(["POST", "POST"]);

    const [biz, child] = list.map((c) => c.body);
    expect(biz).toMatchObject({
      op: "add",
      targetKind: "account",
      entity: {
        name: "New Co",
        category: "business",
        subType: "llc",
        businessType: "llc",
        value: 250000,
        flowMode: "annual",
        owners: OWNERS,
      },
    });
    const bizId = biz.entity.id as string;
    expect(bizId).toMatch(/^[0-9a-f-]{36}$/);

    // The child mirrors what `createAccountForClient` inserts for a new business.
    expect(child.op).toBe("add");
    expect(child.targetKind).toBe("account");
    expect(child.entity).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: "New Co — Cash",
      category: "cash",
      subType: "checking",
      value: 0,
      basis: 0,
      rothValue: 0,
      growthRate: null,
      rmdEnabled: false,
      growthSource: "default",
      turnoverPct: 0,
      annualPropertyTax: 0,
      propertyTaxGrowthRate: 0.03,
      propertyTaxGrowthSource: "custom",
      titlingType: "jtwros",
      flowMode: "annual",
      parentAccountId: bizId,
      isDefaultChecking: true,
      owners: [],
    });
    expect(child.entity.id).not.toBe(bizId);
  });

  it("a second save of the same dialog edits the minted id — it never adds again", async () => {
    const { ref, onAutoSaved } = renderForm();
    type("biz-name", "New Co");
    await act(async () => {
      await ref.current!.saveAsync();
    });
    const bizId = calls()[0].body.entity.id as string;
    // The dialog is handed a locally built saved object, not a server row.
    expect(onAutoSaved).toHaveBeenCalledWith(
      expect.objectContaining({ id: bizId, name: "New Co" }),
      "create",
    );

    fetchMock.mockClear();
    type("biz-name", "New Co Renamed");
    await act(async () => {
      await ref.current!.saveAsync();
    });

    const list = calls();
    expect(list).toHaveLength(1);
    expect(list[0].url).toBe(SCENARIO_URL);
    expect(list[0].body).toMatchObject({
      op: "edit",
      targetKind: "account",
      targetId: bizId,
      desiredFields: { name: "New Co Renamed" },
    });
    expect(onAutoSaved).toHaveBeenLastCalledWith(expect.objectContaining({ id: bizId }), "edit");
  });

  it("a rejected change reports the error and does not flip to edit mode", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "nope" }) });
    const { ref, onAutoSaved } = renderForm();
    type("biz-name", "New Co");

    let result: Awaited<ReturnType<BusinessFormAutoSaveHandle["saveAsync"]>> | undefined;
    await act(async () => {
      result = await ref.current!.saveAsync();
    });

    expect(result).toEqual({ ok: false, error: "nope" });
    expect(onAutoSaved).not.toHaveBeenCalled();
  });
});

describe("BusinessDetailsForm — base mode (unchanged)", () => {
  beforeEach(() => {
    scenarioParam = "";
  });

  it("an edit PUTs the account", async () => {
    const { ref } = renderForm(EXISTING);
    type("biz-name", "Acme Holdings");
    await act(async () => {
      await ref.current!.saveAsync();
    });

    const list = calls();
    expect(list).toHaveLength(1);
    expect(list[0].url).toBe(`/api/clients/c1/accounts/${BIZ}`);
    expect(list[0].method).toBe("PUT");
    expect(list[0].body.name).toBe("Acme Holdings");
  });

  it("an add POSTs the account once — the server provisions the child", async () => {
    const { ref } = renderForm();
    type("biz-name", "New Co");
    await act(async () => {
      await ref.current!.saveAsync();
    });

    const list = calls();
    expect(list).toHaveLength(1);
    expect(list[0].url).toBe("/api/clients/c1/accounts");
    expect(list[0].method).toBe("POST");
  });
});
