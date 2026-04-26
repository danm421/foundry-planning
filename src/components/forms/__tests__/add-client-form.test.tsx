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

    fireEvent.change(screen.getByLabelText(/Retirement Age/i), {
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

  it("create mode POSTs /api/clients regardless of URL", async () => {
    mockSearch = "";
    render(<AddClientForm mode="create" />);

    fireEvent.change(screen.getByLabelText(/First Name/i), {
      target: { value: "New" },
    });
    fireEvent.change(screen.getByLabelText(/Last Name/i), {
      target: { value: "Client" },
    });
    fireEvent.change(screen.getByLabelText(/Date of Birth/i), {
      target: { value: "1980-01-01" },
    });
    fireEvent.submit(document.getElementById("add-client-form")!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/clients");
    expect(init.method).toBe("POST");
  });
});

describe("AddClientForm — scenario mode (?scenario=<sid> in URL)", () => {
  it("edit mode POSTs unified /changes route with op=edit, targetKind=client, targetId, desiredFields", async () => {
    mockSearch = "scenario=scen-456";
    render(<AddClientForm mode="edit" initial={SAMPLE_CLIENT} />);

    fireEvent.change(screen.getByLabelText(/Retirement Age/i), {
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

  it("create mode in scenario URL still POSTs base /api/clients (you can't create a client inside a scenario)", async () => {
    // Even if `?scenario=` happens to be in the URL, creating a brand-new
    // client should always hit the base route — there's no client to attach
    // a scenario_change to until the row exists.
    mockSearch = "scenario=scen-456";
    render(<AddClientForm mode="create" />);

    fireEvent.change(screen.getByLabelText(/First Name/i), {
      target: { value: "New" },
    });
    fireEvent.change(screen.getByLabelText(/Last Name/i), {
      target: { value: "Client" },
    });
    fireEvent.change(screen.getByLabelText(/Date of Birth/i), {
      target: { value: "1980-01-01" },
    });
    fireEvent.submit(document.getElementById("add-client-form")!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/clients");
    expect(init.method).toBe("POST");
  });
});
