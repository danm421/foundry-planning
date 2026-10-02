// @vitest-environment jsdom
/**
 * Details → Family → members and external beneficiaries, written inside and
 * outside a scenario. Inside one (`?scenario=` in the URL) every save is a
 * scenario change and the base tables' own routes are never called (R1); with
 * no scenario each editor still issues its own REST call (R3). Each test pins
 * the WHOLE request list, so a stray base call can't hide behind an expected one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

let search = new URLSearchParams("scenario=scn-1");
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => search,
  usePathname: () => "/clients/c-1/details/family",
}));
vi.mock("@clerk/nextjs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@clerk/nextjs")>()),
  useUser: () => ({ user: { id: "user-1" } }),
}));

import FamilyView, { type FamilyViewProps } from "@/components/family-view";
import { ClientAccessProvider } from "@/components/client-access-provider";

const CHANGES = "/api/clients/c-1/scenarios/scn-1/changes";

const PROPS: FamilyViewProps = {
  clientId: "c-1",
  primary: {
    firstName: "Alice", lastName: "Test", dateOfBirth: "1960-05-15", retirementAge: 67, retirementMonth: 1,
    lifeExpectancy: 93, filingStatus: "single", spouseName: null, spouseLastName: null, spouseDob: null,
    spouseRetirementAge: null, spouseRetirementMonth: null, spouseLifeExpectancy: null,
  },
  initialMembers: [
    {
      id: "fm-child", firstName: "Bobby", lastName: null, relationship: "child", role: "child",
      dateOfBirth: "2015-01-01", notes: null, domesticPartner: false, inheritanceClassOverride: {},
      claimedAsDependent: "auto",
    },
  ],
  initialEntities: [],
  initialExternalBeneficiaries: [{ id: "ext-1", name: "Red Cross", kind: "charity", notes: null }],
  initialAccounts: [],
  initialDesignations: [],
  initialGifts: [],
  initialGiftSeries: [],
  annualExclusionByYear: {},
  planStartYear: 2026,
  scenarioId: "scn-1",
  initialFullAccounts: [],
  initialFullLiabilities: [],
  initialFullIncomes: [],
  initialFullExpenses: [],
  initialFullBusinesses: [],
  initialAssetFamilyMembers: [],
  contacts: null,
};

type Init = { method?: string; body?: string } | undefined;
const fetchMock = vi.fn<(url: string, init?: Init) => Promise<Pick<Response, "ok" | "status" | "json">>>();
// Every request the page made, bar the revocable-trust list it reads on mount.
const requestList = () =>
  fetchMock.mock.calls
    .filter(([url]) => !url.endsWith("/revocable-trusts"))
    .map(([url, init]) => `${init?.method ?? "GET"} ${url}`);
const changeBodies = () =>
  fetchMock.mock.calls
    .filter(([url, init]) => url === CHANGES && init?.method === "POST")
    .map(([, init]) => JSON.parse(init!.body!) as Record<string, unknown>);

beforeEach(() => {
  search = new URLSearchParams("scenario=scn-1");
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url, init) => {
    if (url === CHANGES) return { ok: true, status: 200, json: async () => ({ ok: true }) };
    if (init?.method === "DELETE") return { ok: true, status: 204, json: async () => ({}) };
    if (init?.method === "POST" && url.endsWith("/external-beneficiaries"))
      return { ok: true, status: 201, json: async () => ({ id: "ext-new", name: "Library", kind: "charity", notes: null }) };
    if (init?.method === "PATCH" && url.includes("/external-beneficiaries/"))
      return { ok: true, status: 200, json: async () => ({ id: "ext-1", name: "Red Cross II", kind: "charity", notes: null }) };
    if (init?.method === "POST" || init?.method === "PUT")
      return { ok: true, status: 200, json: async () => ({ id: "fm-new", firstName: "Tom", lastName: null, relationship: "child" }) };
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderPage(over: Partial<FamilyViewProps> = {}) {
  return render(
    <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
      <FamilyView {...PROPS} {...over} />
    </ClientAccessProvider>,
  );
}
const section = (heading: string) =>
  within(screen.getByRole("heading", { name: heading }).closest("section") as HTMLElement);

describe("external beneficiaries on the Family page", () => {
  it("scenario: add writes one scenario change, nothing else", async () => {
    renderPage();
    const ext = section("External Beneficiaries");
    fireEvent.click(ext.getByRole("button", { name: "+ Add" }));
    fireEvent.change(ext.getByPlaceholderText("Name"), { target: { value: "  Library " } });
    fireEvent.change(ext.getByPlaceholderText("Notes"), { target: { value: "reading room" } });
    fireEvent.click(ext.getByRole("button", { name: "Save" }));

    await ext.findByText("Library");
    expect(changeBodies()).toEqual([
      {
        op: "add",
        targetKind: "external_beneficiary",
        entity: { id: expect.any(String), name: "Library", kind: "charity", charityType: "public", notes: "reading room" },
      },
    ]);
    expect(requestList()).toEqual([`POST ${CHANGES}`]);
  });

  it("scenario: edit writes one scenario change with the changed fields", async () => {
    renderPage();
    const ext = section("External Beneficiaries");
    fireEvent.click(ext.getByText("Red Cross"));
    fireEvent.change(ext.getByDisplayValue("Red Cross"), { target: { value: "Red Cross II" } });
    fireEvent.click(ext.getByRole("button", { name: "Save" }));

    await ext.findByText("Red Cross II");
    expect(requestList()).toEqual([`POST ${CHANGES}`]);
    expect(changeBodies()).toEqual([
      {
        op: "edit",
        targetKind: "external_beneficiary",
        targetId: "ext-1",
        desiredFields: { name: "Red Cross II", kind: "charity", notes: null },
      },
    ]);
  });

  it("scenario: an unchanged save of a charity with notes sends the row's own values", async () => {
    renderPage({ initialExternalBeneficiaries: [{ id: "ext-1", name: "Red Cross", kind: "charity", notes: "Annual gift" }] });
    const ext = section("External Beneficiaries");
    fireEvent.click(ext.getByText("Red Cross"));
    fireEvent.click(ext.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(changeBodies()).toHaveLength(1));
    expect(changeBodies()[0].desiredFields).toEqual({ name: "Red Cross", kind: "charity", notes: "Annual gift" });
  });

  it("scenario: delete writes one scenario remove, nothing else", async () => {
    renderPage();
    const ext = section("External Beneficiaries");
    fireEvent.click(ext.getByRole("button", { name: "Edit" }));
    fireEvent.click(ext.getByRole("button", { name: "Delete Red Cross" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(ext.queryByText("Red Cross")).toBeNull());
    expect(requestList()).toEqual([`POST ${CHANGES}`]);
    expect(changeBodies()).toEqual([{ op: "remove", targetKind: "external_beneficiary", targetId: "ext-1" }]);
  });

  describe("base mode", () => {
    beforeEach(() => {
      search = new URLSearchParams();
    });

    it("add still POSTs /external-beneficiaries", async () => {
      renderPage();
      const ext = section("External Beneficiaries");
      fireEvent.click(ext.getByRole("button", { name: "+ Add" }));
      fireEvent.change(ext.getByPlaceholderText("Name"), { target: { value: "Library" } });
      fireEvent.click(ext.getByRole("button", { name: "Save" }));
      await ext.findByText("Library");
      expect(requestList()).toEqual(["POST /api/clients/c-1/external-beneficiaries"]);
    });

    it("edit still PATCHes the row", async () => {
      renderPage();
      const ext = section("External Beneficiaries");
      fireEvent.click(ext.getByText("Red Cross"));
      fireEvent.change(ext.getByDisplayValue("Red Cross"), { target: { value: "Red Cross II" } });
      fireEvent.click(ext.getByRole("button", { name: "Save" }));
      await ext.findByText("Red Cross II");
      expect(requestList()).toEqual(["PATCH /api/clients/c-1/external-beneficiaries/ext-1"]);
    });

    it("delete still DELETEs the row", async () => {
      renderPage();
      const ext = section("External Beneficiaries");
      fireEvent.click(ext.getByRole("button", { name: "Edit" }));
      fireEvent.click(ext.getByRole("button", { name: "Delete Red Cross" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
      await waitFor(() => expect(ext.queryByText("Red Cross")).toBeNull());
      expect(requestList()).toEqual(["DELETE /api/clients/c-1/external-beneficiaries/ext-1"]);
    });
  });
});

describe("family members on the Family page", () => {
  const fill = (label: RegExp, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });

  it("scenario: add writes one scenario change, nothing else", async () => {
    renderPage();
    fireEvent.click(section("Family Members").getByRole("button", { name: "+ Add" }));
    fill(/first name/i, "Tom");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add" }));

    await section("Family Members").findByText(/Tom/);
    expect(requestList()).toEqual([`POST ${CHANGES}`]);
    expect(changeBodies()).toEqual([
      {
        op: "add",
        targetKind: "family_member",
        entity: expect.objectContaining({ id: expect.any(String), firstName: "Tom", lastName: null, relationship: "child" }),
      },
    ]);
  });

  it("scenario: edit writes one scenario change, nothing else", async () => {
    renderPage();
    fireEvent.click(section("Family Members").getByText(/Bobby/));
    fill(/first name/i, "Robert");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save Changes" }));

    await section("Family Members").findByText(/Robert/);
    expect(requestList()).toEqual([`POST ${CHANGES}`]);
    expect(changeBodies()).toEqual([
      expect.objectContaining({
        op: "edit",
        targetKind: "family_member",
        targetId: "fm-child",
        desiredFields: expect.objectContaining({ firstName: "Robert", lastName: null }),
      }),
    ]);
  });

  it("scenario: delete writes one scenario remove, nothing else", async () => {
    renderPage();
    const members = section("Family Members");
    fireEvent.click(members.getByRole("button", { name: "Edit" }));
    fireEvent.click(members.getByRole("button", { name: "Delete Bobby" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(members.queryByText(/Bobby/)).toBeNull());
    expect(requestList()).toEqual([`POST ${CHANGES}`]);
    expect(changeBodies()).toEqual([{ op: "remove", targetKind: "family_member", targetId: "fm-child" }]);
  });

  describe("base mode", () => {
    beforeEach(() => {
      search = new URLSearchParams();
    });

    it("add still POSTs /family-members", async () => {
      renderPage();
      fireEvent.click(section("Family Members").getByRole("button", { name: "+ Add" }));
      fill(/first name/i, "Tom");
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add" }));
      await section("Family Members").findByText(/Tom/);
      expect(requestList()).toEqual(["POST /api/clients/c-1/family-members"]);
    });

    it("edit still PUTs the row", async () => {
      renderPage();
      fireEvent.click(section("Family Members").getByText(/Bobby/));
      fill(/first name/i, "Robert");
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save Changes" }));
      await waitFor(() => expect(requestList()).toEqual(["PUT /api/clients/c-1/family-members/fm-child"]));
    });

    it("delete still DELETEs the row", async () => {
      renderPage();
      const members = section("Family Members");
      fireEvent.click(members.getByRole("button", { name: "Edit" }));
      fireEvent.click(members.getByRole("button", { name: "Delete Bobby" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
      await waitFor(() => expect(members.queryByText(/Bobby/)).toBeNull());
      expect(requestList()).toEqual(["DELETE /api/clients/c-1/family-members/fm-child"]);
    });
  });
});

describe("Beneficiary Designations summary", () => {
  const acct = { id: "a1", name: "Brokerage", category: "taxable", value: 1, subType: "brokerage", ownerFamilyMemberId: null, ownerEntityId: null };
  const designation = (over: Record<string, unknown>) => ({
    id: "d", targetKind: "account", accountId: "a1", entityId: null, tier: "primary", familyMemberId: null,
    externalBeneficiaryId: null, entityIdRef: null, householdRole: null, percentage: 100, sortOrder: 0, ...over,
  });

  it("shows the designations the page was handed, and the new ones after a refresh", () => {
    const first = [designation({ id: "d1", familyMemberId: "fm-child" })];
    const utils = renderPage({ initialAccounts: [acct], initialDesignations: first as never });
    expect(screen.getByText("Bobby — 100%")).toBeTruthy();

    const refreshed = [designation({ id: "d2", externalBeneficiaryId: "ext-1" })];
    utils.rerender(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <FamilyView {...PROPS} initialAccounts={[acct]} initialDesignations={refreshed as never} />
      </ClientAccessProvider>,
    );
    expect(screen.getByText("Red Cross — 100%")).toBeTruthy();
    expect(screen.queryByText("Bobby — 100%")).toBeNull();
  });
});
