// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SendIntakeForm from "../send-intake-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const HIT = {
  id: "client-1",
  householdTitle: "Bob & Beth Baxter",
  primaryFirstName: "Bob",
  primaryLastName: "Baxter",
  primaryEmail: "bob@baxter.test",
};

function okFetch() {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
}

/** Fetch that answers the roster search with `hits` and any POST with 200. */
function searchFetch(hits: unknown[]) {
  return vi.fn().mockImplementation(async (url: string) =>
    typeof url === "string" && url.startsWith("/api/clients/search")
      ? { ok: true, status: 200, json: async () => hits }
      : { ok: true, status: 200, json: async () => ({}) },
  );
}

/** Search the roster and click the first result. */
async function pickClient(title: string) {
  fireEvent.click(screen.getByRole("button", { name: /existing client/i }));
  fireEvent.change(screen.getByLabelText(/^client$/i), { target: { value: "bax" } });
  const option = await screen.findByRole("option", { name: title }, { timeout: 2000 });
  fireEvent.mouseDown(option);
}

describe("SendIntakeForm", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", okFetch());
  });

  it("renders first name, last name, and email inputs", () => {
    render(<SendIntakeForm defaultSections={null} />);
    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/last name/i, { selector: "input" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^email/i)).toBeInTheDocument();
  });

  it("sends the two name fields as one recipientName, with no clientId", async () => {
    render(<SendIntakeForm defaultSections={null} />);
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: "Jane" } });
    fireEvent.change(screen.getByLabelText(/last name/i, { selector: "input" }), { target: { value: "Smith" } });
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: "jane@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/data-collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "blank",
          recipientName: "Jane Smith",
          recipientEmail: "jane@example.com",
          sections: ["family", "accounts", "income", "property", "goals", "documents"],
        }),
      });
    });
  });

  it("sends a last name alone without a leading space", async () => {
    render(<SendIntakeForm defaultSections={null} />);
    fireEvent.change(screen.getByLabelText(/last name/i, { selector: "input" }), { target: { value: "Smith" } });
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: "jane@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
      expect(body.recipientName).toBe("Smith");
    });
  });

  it("prefills name and email from a picked client and posts its clientId", async () => {
    vi.stubGlobal("fetch", searchFetch([HIT]));
    render(<SendIntakeForm defaultSections={null} />);

    await pickClient("Bob & Beth Baxter");

    expect(screen.getByLabelText(/first name/i)).toHaveValue("Bob");
    expect(screen.getByLabelText(/last name/i, { selector: "input" })).toHaveValue("Baxter");
    expect(screen.getByLabelText(/^email/i)).toHaveValue("bob@baxter.test");

    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      const post = vi
        .mocked(fetch)
        .mock.calls.find(([url]) => url === "/api/data-collection");
      expect(post).toBeDefined();
      expect(JSON.parse(post![1]!.body as string)).toEqual({
        mode: "blank",
        clientId: "client-1",
        recipientName: "Bob Baxter",
        recipientEmail: "bob@baxter.test",
        sections: ["family", "accounts", "income", "property", "goals", "documents"],
      });
    });
  });

  it("keeps a typed email when the picked client has none", async () => {
    vi.stubGlobal("fetch", searchFetch([{ ...HIT, primaryEmail: null }]));
    render(<SendIntakeForm defaultSections={null} />);

    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: "typed@example.com" } });
    await pickClient("Bob & Beth Baxter");

    expect(screen.getByLabelText(/^email/i)).toHaveValue("typed@example.com");
  });

  it("blocks an existing-client send until a client is picked", async () => {
    render(<SendIntakeForm defaultSections={null} />);
    fireEvent.click(screen.getByRole("button", { name: /existing client/i }));
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: "jane@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/choose a client/i);
    });
    expect(fetch).not.toHaveBeenCalledWith("/api/data-collection", expect.anything());
  });

  it("drops the picked client when switching back to a prospect send", async () => {
    vi.stubGlobal("fetch", searchFetch([HIT]));
    render(<SendIntakeForm defaultSections={null} />);

    await pickClient("Bob & Beth Baxter");
    fireEvent.click(screen.getByRole("button", { name: /new prospect/i }));
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      const post = vi
        .mocked(fetch)
        .mock.calls.find(([url]) => url === "/api/data-collection");
      expect(post).toBeDefined();
      expect(JSON.parse(post![1]!.body as string)).not.toHaveProperty("clientId");
    });
  });

  it("shows validation error for invalid email", async () => {
    const { container } = render(<SendIntakeForm defaultSections={null} />);
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: "not-an-email" } });
    // Use fireEvent.submit on the form to bypass jsdom constraint-validation
    // that blocks the click on a type=submit button
    const form = container.querySelector("form")!;
    fireEvent.submit(form);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/valid email/i);
    });
  });

  it("seeds the picker from the advisor's saved default", async () => {
    render(<SendIntakeForm defaultSections={["family", "documents"]} />);
    expect(screen.getByRole("checkbox", { name: /^documents$/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^goals$/i })).not.toBeChecked();

    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() => {
      const post = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/data-collection");
      expect(JSON.parse(post![1]!.body as string).sections).toEqual(["family", "documents"]);
    });
  });

  it("forces family back into a saved default that omits it, for a prospect send", async () => {
    // The create route does this at write time. Doing it here too is what stops
    // the advisor from sending a set that differs from the one on screen.
    render(<SendIntakeForm defaultSections={["documents"]} />);
    expect(screen.getByRole("checkbox", { name: /family/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /family/i })).toBeDisabled();
  });

  it("keeps family in a prospect send when a preset chip would have dropped it", async () => {
    // A preset chip replaces the whole set, so it bypasses the checkbox's own
    // lock. Without the prospect rule on every emission, "Documents only" left
    // Family unchecked AND disabled — unfixable on screen — while the create
    // route put it back at write time, so the form sent was not the one shown.
    render(<SendIntakeForm defaultSections={null} />);
    fireEvent.click(screen.getByRole("button", { name: /documents only/i }));

    expect(screen.getByRole("checkbox", { name: /family/i })).toBeChecked();
    expect(screen.getByRole("link", { name: /preview this form/i })).toHaveAttribute(
      "href",
      "/data-collection/preview?steps=family,documents",
    );

    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() => {
      const post = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/data-collection");
      expect(JSON.parse(post![1]!.body as string).sections).toEqual(["family", "documents"]);
    });
  });

  it("lets an existing-client send drop family via a preset chip", async () => {
    // The mirror of the case above: the rule is prospect-only, so a client send
    // must still be able to reach a genuine Documents-only form.
    vi.stubGlobal("fetch", searchFetch([HIT]));
    render(<SendIntakeForm defaultSections={null} />);
    await pickClient("Bob & Beth Baxter");
    fireEvent.click(screen.getByRole("button", { name: /documents only/i }));

    expect(screen.getByRole("checkbox", { name: /family/i })).not.toBeChecked();
  });

  it("unlocks Family for an existing-client send and re-locks it for a prospect", async () => {
    vi.stubGlobal("fetch", searchFetch([HIT]));
    render(<SendIntakeForm defaultSections={["documents"]} />);

    await pickClient("Bob & Beth Baxter");
    const family = () => screen.getByRole("checkbox", { name: /family/i });
    expect(family()).not.toBeDisabled();

    fireEvent.click(family());
    expect(family()).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: /new prospect/i }));
    expect(family()).toBeChecked();
    expect(family()).toBeDisabled();
  });

  it("points the Preview link at the set on screen", () => {
    render(<SendIntakeForm defaultSections={["family", "documents"]} />);
    expect(screen.getByRole("link", { name: /preview this form/i })).toHaveAttribute(
      "href",
      "/data-collection/preview?steps=family,documents",
    );
  });

  it("shows 429 rate limit error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) }));
    render(<SendIntakeForm defaultSections={null} />);
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/rate limit/i);
    });
  });
});
