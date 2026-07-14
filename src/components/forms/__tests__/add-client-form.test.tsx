// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import AddClientForm, { type ClientFormInitial } from "../add-client-form";

const refreshMock = vi.fn();
let mockSearch = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
  useSearchParams: () => new URLSearchParams(mockSearch),
  usePathname: () => "/clients/client-123",
}));

const SAMPLE_CLIENT: ClientFormInitial = {
  id: "client-123",
  firstName: "Cooper",
  lastName: "Sample",
  dateOfBirth: "1975-04-12",
  retirementAge: 65,
  lifeExpectancy: 92,
  filingStatus: "married_joint",
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  refreshMock.mockReset();
  mockSearch = "";
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ id: "client-123" }),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AddClientForm — base mode (no ?scenario= in URL)", () => {
  it("edit mode PUTs /api/clients/[id] with the form body", async () => {
    mockSearch = "";
    render(<AddClientForm mode="edit" initial={SAMPLE_CLIENT} />);

    fireEvent.change(screen.getByLabelText("Retirement Age (age)"), {
      target: { value: "67" },
    });
    fireEvent.submit(document.getElementById("add-client-form")!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/clients/client-123");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body as string);
    expect(body.retirementAge).toBe(67);
    expect(body.firstName).toBe("Cooper");
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});

describe("AddClientForm — scenario mode (?scenario=<sid> in URL)", () => {
  it("edit mode POSTs unified /changes route with op=edit, targetKind=client, targetId, desiredFields", async () => {
    mockSearch = "scenario=scen-456";
    render(<AddClientForm mode="edit" initial={SAMPLE_CLIENT} />);

    fireEvent.change(screen.getByLabelText("Retirement Age (age)"), {
      target: { value: "67" },
    });
    fireEvent.submit(document.getElementById("add-client-form")!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/clients/client-123/scenarios/scen-456/changes");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string);
    expect(body.op).toBe("edit");
    expect(body.targetKind).toBe("client");
    expect(body.targetId).toBe("client-123");
    expect(body.desiredFields).toBeDefined();
    expect(body.desiredFields.retirementAge).toBe(67);
    expect(body.desiredFields.firstName).toBe("Cooper");
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});

// Mock the picker so we can drive selection deterministically.
vi.mock("@/components/crm-household-picker", () => ({
  CrmHouseholdPicker: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button type="button" data-testid="mock-pick-hh" onClick={() => onSelect("hh-1")}>
      Pick household
    </button>
  ),
}));

// Mock useUser so advisorId is available for inline household creation.
vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ user: { id: "user-1" }, isLoaded: true }),
}));

describe("AddClientForm — create mode, pick existing CRM household", () => {
  it("POSTs /api/clients with crmHouseholdId and planning fields, no identity fields", async () => {
    mockSearch = "";
    render(<AddClientForm mode="create" />);

    // Pick a household via the mocked picker.
    fireEvent.click(screen.getByTestId("mock-pick-hh"));

    // First/Last/DOB inputs should not be rendered in this mode.
    expect(screen.queryByLabelText(/First Name/i)).toBeNull();
    expect(screen.queryByLabelText(/Last Name/i)).toBeNull();
    expect(screen.queryByLabelText(/Date of Birth/i)).toBeNull();

    fireEvent.submit(document.getElementById("add-client-form")!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/clients");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.crmHouseholdId).toBe("hh-1");
    expect(body.retirementAge).toBe(65);
    expect(body.lifeExpectancy).toBe(95);
    // Strict schema rejects unknown keys — make sure we don't send them.
    expect(body.firstName).toBeUndefined();
    expect(body.lastName).toBeUndefined();
    expect(body.dateOfBirth).toBeUndefined();
  });
});

describe("AddClientForm — create mode, inline new-household checkbox", () => {
  it("POSTs household, contact(s), then client in sequence", async () => {
    mockSearch = "";
    // fetchMock returns different shapes per call. Sequence:
    //   1) POST /api/crm/households -> { household: { id: "hh-new" } }
    //   2) POST /api/crm/households/hh-new/contacts -> { contact: { id: "c-1" } }
    //   3) POST /api/clients -> { id: "client-new" }
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ household: { id: "hh-new" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ contact: { id: "c-1" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "client-new" }) });

    render(<AddClientForm mode="create" />);

    // Flip the "Create a new household" checkbox to reveal identity fields.
    fireEvent.click(screen.getByLabelText(/Create a new household/i));

    fireEvent.change(screen.getByLabelText(/First Name/i), { target: { value: "Michael" } });
    fireEvent.change(screen.getByLabelText(/Last Name/i),  { target: { value: "Jordan" } });
    fireEvent.change(screen.getByLabelText(/Date of Birth/i), { target: { value: "1965-01-01" } });

    fireEvent.submit(document.getElementById("add-client-form")!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    // 1) household
    const [hUrl, hInit] = fetchMock.mock.calls[0];
    expect(hUrl).toBe("/api/crm/households");
    expect(hInit.method).toBe("POST");
    const hBody = JSON.parse(hInit.body as string);
    expect(hBody.name).toBe("Michael Jordan");
    expect(hBody.status).toBe("prospect");
    expect(hBody.advisorId).toBe("user-1");

    // 2) primary contact
    const [cUrl, cInit] = fetchMock.mock.calls[1];
    expect(cUrl).toBe("/api/crm/households/hh-new/contacts");
    expect(cInit.method).toBe("POST");
    const cBody = JSON.parse(cInit.body as string);
    expect(cBody.role).toBe("primary");
    expect(cBody.firstName).toBe("Michael");
    expect(cBody.lastName).toBe("Jordan");
    expect(cBody.dateOfBirth).toBe("1965-01-01");

    // 3) planning client
    const [pUrl, pInit] = fetchMock.mock.calls[2];
    expect(pUrl).toBe("/api/clients");
    expect(pInit.method).toBe("POST");
    const pBody = JSON.parse(pInit.body as string);
    expect(pBody.crmHouseholdId).toBe("hh-new");
    expect(pBody.firstName).toBeUndefined();
    expect(pBody.dateOfBirth).toBeUndefined();
  });

  it("posts two contacts (primary + spouse) when spouse is enabled, with different-last-name household name", async () => {
    mockSearch = "";
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ household: { id: "hh-new" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ contact: { id: "c-1" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ contact: { id: "c-2" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "client-new" }) });

    render(<AddClientForm mode="create" />);

    fireEvent.click(screen.getByLabelText(/Create a new household/i));
    fireEvent.change(screen.getByLabelText(/First Name/i), { target: { value: "Michael" } });
    fireEvent.change(screen.getByLabelText(/Last Name/i),  { target: { value: "Jordan" } });
    fireEvent.change(screen.getByLabelText(/Date of Birth/i), { target: { value: "1965-01-01" } });

    // Enable spouse and provide a different last name.
    fireEvent.click(screen.getByLabelText(/Add Spouse/i));
    fireEvent.change(screen.getByLabelText(/Spouse First Name/i), { target: { value: "Jane" } });
    fireEvent.change(screen.getByLabelText(/Spouse Last Name/i),  { target: { value: "Smith" } });
    fireEvent.change(screen.getByLabelText(/Spouse Date of Birth/i), { target: { value: "1966-02-02" } });

    fireEvent.submit(document.getElementById("add-client-form")!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));

    const hBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(hBody.name).toBe("Michael Jordan & Jane Smith");

    const primaryBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(primaryBody.role).toBe("primary");

    const spouseBody = JSON.parse(fetchMock.mock.calls[2][1].body as string);
    expect(spouseBody.role).toBe("spouse");
    expect(spouseBody.firstName).toBe("Jane");
    expect(spouseBody.lastName).toBe("Smith");
    expect(spouseBody.dateOfBirth).toBe("1966-02-02");

    expect(fetchMock.mock.calls[3][0]).toBe("/api/clients");
  });
});
