// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";

const refresh = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, replace }) }));

import { WorkspaceAdminCard } from "../WorkspaceAdminCard";

const fetchMock = vi.fn();

function ok(body: unknown = { ok: true }) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  fetchMock.mockReset();
  refresh.mockReset();
  replace.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const G_ID = "6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f";
const MS_ID = "0b9e8d7c-6a5f-4e3d-8c2b-1a0f9e8d7c6b";
const SAM_ID = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";

const MEMBERS = [
  {
    userId: "u_dana",
    displayName: "Dana Whitfield",
    accounts: [
      { connectionId: G_ID, provider: "google" as const, email: "dana@gmail.com", status: "connected" as const },
      { connectionId: MS_ID, provider: "microsoft" as const, email: "dana@hartwell.com", status: "connected" as const },
    ],
  },
  { userId: "u_marcus", displayName: "Marcus Lee", accounts: [] },
  {
    userId: "u_sam",
    displayName: "Sam Ortiz",
    accounts: [
      { connectionId: SAM_ID, provider: "microsoft" as const, email: "sam@hartwell.com", status: "needs_reconnect" as const },
    ],
  },
];
const APPROVAL = { approvedAt: "2026-10-28T15:00:00.000Z" };

/** The list item holding one person's addresses. */
function personRow(name: string): HTMLElement {
  const li = screen.getByText(name).closest("li");
  if (!li) throw new Error(`no row for ${name}`);
  return li;
}

describe("WorkspaceAdminCard — connected addresses", () => {
  it("a person with a Google and a Microsoft address shows both rows with their provider names", () => {
    render(<WorkspaceAdminCard members={MEMBERS} approval={null} flash={null} />);
    expect(screen.getByRole("heading", { name: "Connected addresses" })).toBeTruthy();

    const dana = within(personRow("Dana Whitfield"));
    const google = dana.getByText("dana@gmail.com").closest("li") as HTMLElement;
    const outlook = dana.getByText("dana@hartwell.com").closest("li") as HTMLElement;
    expect(within(google).getByText("Google")).toBeTruthy();
    expect(within(google).getByText("Connected")).toBeTruthy();
    expect(within(outlook).getByText("Microsoft 365")).toBeTruthy();
    expect(within(outlook).getByText("Connected")).toBeTruthy();
  });

  it("a person with none shows 'No addresses connected'", () => {
    render(<WorkspaceAdminCard members={MEMBERS} approval={null} flash={null} />);
    expect(within(personRow("Marcus Lee")).getByText("No addresses connected")).toBeTruthy();
    expect(screen.getAllByText("No addresses connected")).toHaveLength(1);
  });

  it("an address that needs to reconnect says so", () => {
    render(<WorkspaceAdminCard members={MEMBERS} approval={null} flash={null} />);
    expect(within(personRow("Sam Ortiz")).getByText("Needs to reconnect")).toBeTruthy();
  });

  it("renders no access switch and no 'Turn on for everyone'", () => {
    render(<WorkspaceAdminCard members={MEMBERS} approval={APPROVAL} flash={null} />);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByText(/Turn on for everyone/)).toBeNull();
  });

  it("Disconnect asks first, then posts to that address's admin URL and refreshes", async () => {
    fetchMock.mockReturnValue(ok());
    render(<WorkspaceAdminCard members={MEMBERS} approval={null} flash={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Disconnect dana@gmail.com" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Disconnect dana@gmail.com?" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/workspace/admin/connections/${G_ID}/disconnect`);
    expect(init.method).toBe("POST");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a refused Disconnect names the address", async () => {
    fetchMock.mockReturnValue(Promise.resolve(new Response("{}", { status: 500 })));
    render(<WorkspaceAdminCard members={MEMBERS} approval={null} flash={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Disconnect sam@hartwell.com" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't disconnect sam@hartwell.com. Try again.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("the Disconnect confirmation can't send twice while it's out", async () => {
    const answer = deferred<Response>();
    fetchMock.mockReturnValue(answer.promise);
    render(<WorkspaceAdminCard members={MEMBERS} approval={null} flash={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect dana@hartwell.com" }));

    const confirm = screen.getByRole("button", { name: "Disconnect" });
    fireEvent.click(confirm);
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    answer.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});

describe("WorkspaceAdminCard — Disconnect everyone", () => {
  it("asks first with the fixed copy, then posts disconnect-all and refreshes", async () => {
    fetchMock.mockReturnValue(ok());
    render(<WorkspaceAdminCard members={MEMBERS} approval={APPROVAL} flash={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Disconnect everyone" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Every advisor's Google and Microsoft addresses leave Workspace. To fully remove Foundry on Microsoft's side, also remove \"Foundry Planning\" from Microsoft Entra → Enterprise applications.",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/workspace/admin/disconnect-all");
  });

  it("isn't offered when nothing is connected or approved", () => {
    const nobody = MEMBERS.map((m) => ({ ...m, accounts: [] }));
    render(<WorkspaceAdminCard members={nobody} approval={null} flash={null} />);
    expect(screen.queryByRole("button", { name: "Disconnect everyone" })).toBeNull();
  });
});

describe("WorkspaceAdminCard — Microsoft organization approval (optional)", () => {
  it("is labelled optional and says when it's needed", () => {
    render(<WorkspaceAdminCard members={[]} approval={null} flash={null} />);
    expect(screen.getByRole("heading", { name: "Microsoft organization approval (optional)" })).toBeTruthy();
    expect(
      screen.getByText("Only needed if your Microsoft organization stops people approving apps themselves."),
    ).toBeTruthy();
  });

  it("shows the approval date once approved", () => {
    render(<WorkspaceAdminCard members={[]} approval={APPROVAL} flash={null} />);
    expect(screen.getByText(/Approved/).textContent).toContain("Oct 28, 2026");
    expect(screen.queryByRole("button", { name: "Copy approval link" })).toBeNull();
  });

  it("Approve posts mode redirect to the existing start route and goes to Microsoft", async () => {
    fetchMock.mockReturnValue(ok({ url: "about:blank#consent" }));
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    render(<WorkspaceAdminCard members={[]} approval={null} flash={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Approve Microsoft 365" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workspace/microsoft/admin-consent/start");
    expect(JSON.parse(init.body)).toEqual({ mode: "redirect" });
    await waitFor(() => expect(assign).toHaveBeenCalledWith("about:blank#consent"));
  });

  it("without ClipboardItem, copies the approval link with writeText and says it works once", async () => {
    fetchMock.mockReturnValue(ok({ url: "https://app/consent?x=1" }));
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<WorkspaceAdminCard members={[]} approval={null} flash={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy approval link" }));

    await screen.findByText("Link copied — it works once and expires in 7 days.");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ mode: "link" });
    expect(writeText).toHaveBeenCalledWith("https://app/consent?x=1");
  });

  it("(Safari) starts the clipboard write inside the click, before the link exists", async () => {
    const answer = deferred<Response>();
    fetchMock.mockReturnValue(answer.promise);
    const items: Record<string, Promise<Blob>>[] = [];
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(data: Record<string, Promise<Blob>>) {
          items.push(data);
        }
      },
    );
    // Like the browser, the write settles once the item's text does.
    const write = vi.fn(async (list: unknown[]) => {
      expect(list).toHaveLength(1);
      await items[0]["text/plain"];
    });
    vi.stubGlobal("navigator", { clipboard: { write, writeText: vi.fn() } });
    render(<WorkspaceAdminCard members={[]} approval={null} flash={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy approval link" }));
    // Still inside the click: the server hasn't answered yet.
    expect(write).toHaveBeenCalledTimes(1);

    answer.resolve(new Response(JSON.stringify({ url: "https://app/consent?x=1" }), { status: 200 }));
    await screen.findByText("Link copied — it works once and expires in 7 days.");
    const blob = await items[0]["text/plain"];
    expect(blob.type).toBe("text/plain");
    expect(await blob.text()).toBe("https://app/consent?x=1");
  });

  it("when the clipboard refuses, shows the link to copy by hand — never 'couldn't create'", async () => {
    fetchMock.mockReturnValue(ok({ url: "https://app/consent?x=1" }));
    const writeText = vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<WorkspaceAdminCard members={[]} approval={null} flash={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy approval link" }));

    expect(await screen.findByRole("textbox", { name: "Approval link" })).toHaveValue("https://app/consent?x=1");
    expect(screen.getByText(/Copy this link by hand/)).toBeTruthy();
    expect(screen.queryByText(/Couldn.t create the approval link/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says it couldn't create the link only when the server refused", async () => {
    fetchMock.mockReturnValue(Promise.resolve(new Response("{}", { status: 429 })));
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<WorkspaceAdminCard members={[]} approval={null} flash={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy approval link" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't create the approval link. Try again.");
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Approval link" })).toBeNull();
  });
});

describe("WorkspaceAdminCard — the approval flash", () => {
  it("shows the expired-link banner", () => {
    render(<WorkspaceAdminCard members={[]} approval={null} flash="consent_expired" />);
    expect(screen.getByText(/link expired or was already used/i)).toBeTruthy();
  });

  it("shows the declined banner", () => {
    render(<WorkspaceAdminCard members={[]} approval={null} flash="consent_declined" />);
    expect(screen.getByText(/wasn.t approved/i)).toBeTruthy();
  });

  it("never says 'approved' when there is no approval", () => {
    render(<WorkspaceAdminCard members={[]} approval={null} flash="approved" />);
    expect(screen.queryByText(/Microsoft 365 is approved/)).toBeNull();
  });

  it("clears the flag from the URL once read, and keeps the banner until the page is left", async () => {
    const { rerender } = render(<WorkspaceAdminCard members={MEMBERS} approval={APPROVAL} flash="approved" />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/settings/integrations/microsoft_365"));
    // The cleaned URL renders the page again with no flash.
    rerender(<WorkspaceAdminCard members={MEMBERS} approval={APPROVAL} flash={null} />);
    expect(screen.getByText(/Microsoft 365 is approved/)).toBeTruthy();
    // No more "choose which advisors get it": advisors connect themselves.
    expect(screen.queryByText(/choose which advisors/i)).toBeNull();
  });

  it("leaves a clean URL alone", () => {
    render(<WorkspaceAdminCard members={MEMBERS} approval={APPROVAL} flash={null} />);
    expect(replace).not.toHaveBeenCalled();
  });

  it("drops the 'approved' banner once Disconnect everyone has removed the approval", async () => {
    fetchMock.mockReturnValue(ok());
    const { rerender } = render(<WorkspaceAdminCard members={MEMBERS} approval={APPROVAL} flash="approved" />);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect everyone" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());

    rerender(<WorkspaceAdminCard members={MEMBERS.map((m) => ({ ...m, accounts: [] }))} approval={null} flash={null} />);
    expect(screen.queryByText(/Microsoft 365 is approved/)).toBeNull();
    expect(screen.getByRole("button", { name: "Approve Microsoft 365" })).toBeTruthy();
  });
});
