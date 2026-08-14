// @vitest-environment jsdom
// The panel is where an advisor reads what the writing assistant is being sent
// and takes it back. Everything asserted here is a way that promise can quietly
// break: a summary drawn before the data arrived, a failure that lands on the
// wrong row, a sample marked "in every chapter" that the resolver never sends.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { VoiceProfilePanel } from "../voice-profile-panel";
import { MAX_SAMPLES } from "@/lib/presentations/story/voice/resolve";
import { VOICE_TEXT_MAX } from "@/lib/schemas/story-voice";

const ME = "user_me";

interface Sample {
  id: string;
  text: string;
  sourceChapterId: string | null;
  enabled: boolean;
  firmDefault: boolean;
}

function sample(id: string, enabled: boolean, over: Partial<Sample> = {}): Sample {
  return {
    id,
    text: `Sample ${id}: a passage long enough to be worth keeping.`,
    sourceChapterId: null,
    enabled,
    firmDefault: false,
    ...over,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** A write is anything with a `method`; the two GETs are told apart by path. */
const isSamplesUrl = (url: unknown) => String(url).includes("/story-voice/samples");

/**
 * The panel's two READ legs, answered from one place. `write` overrides the
 * mutating half — every test that asserts on a failure supplies its own.
 */
function stub(
  { profile = null as { advisorUserId: string; styleNote: string } | null, samples = [] as Sample[] },
  write: (url: string, init: RequestInit) => Response = () => json({ ok: true }),
) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method) return write(url, init);
    return isSamplesUrl(url) ? json({ samples }) : json({ profile });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function calls() {
  return (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
}

function writes(method: string) {
  return calls().filter((c) => (c[1] as RequestInit | undefined)?.method === method);
}

/** A sample row by its position in the list, which is the order the route
 *  returns and the order the resolver's cap applies to. */
function row(n: number): HTMLElement {
  return screen.getByRole("listitem", { name: `Voice sample ${n}` });
}

beforeEach(() => {
  // The panel logs every failed request. Silenced so a deliberate failure in a
  // test does not read as a real one in the run output.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Rule 1: an empty list is "not loaded yet", never "all clear" ───────────────

describe("before a GET has answered", () => {
  it("says nothing about how many samples reach a prompt", () => {
    // Neither GET ever resolves.
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    render(<VoiceProfilePanel isAdmin={false} userId={ME} />);
    expect(screen.queryByText(/into every chapter/)).toBeNull();
    expect(screen.queryByText(/No samples yet/)).toBeNull();
  });

  it("leaves the style-note box disabled, so a firm note cannot be cleared unread", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    render(<VoiceProfilePanel isAdmin={false} userId={ME} />);
    expect((screen.getByLabelText(/Style note/) as HTMLTextAreaElement).disabled).toBe(true);
  });

  it("reports a refused samples GET as a failure, not as an empty list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        isSamplesUrl(url) ? json({ error: "nope" }, 500) : json({ profile: null }),
      ),
    );
    render(<VoiceProfilePanel isAdmin={false} userId={ME} />);
    expect(await screen.findByText(/Couldn't load your samples/)).toBeTruthy();
    expect(screen.queryByText(/No samples yet/)).toBeNull();
  });

  it("says the list is empty once a GET has actually answered with nothing", async () => {
    stub({ samples: [] });
    render(<VoiceProfilePanel isAdmin={false} userId={ME} />);
    expect(await screen.findByText(/No samples yet/)).toBeTruthy();
  });
});

// ── Requirement C: which samples are ACTUALLY sent ────────────────────────────

describe("the cap on how many samples reach the prompt", () => {
  const overflowing = [
    sample("a", true),
    sample("b", true),
    sample("c", true),
    sample("d", true),
    sample("e", true),
  ];

  it("marks the rows past the cap apart from the rows in every chapter", async () => {
    stub({ samples: overflowing });
    render(<VoiceProfilePanel isAdmin={false} userId={ME} />);
    await screen.findByText(/into every chapter/);

    for (let n = 1; n <= MAX_SAMPLES; n++) {
      expect(within(row(n)).getByText("In every chapter")).toBeTruthy();
    }
    // The fifth is switched ON and goes nowhere. A panel that showed five live
    // toggles and nothing else would report a state the model never sees.
    expect(within(row(MAX_SAMPLES + 1)).getByText("Over the limit")).toBeTruthy();
    expect(within(row(MAX_SAMPLES + 1)).getByText(/only the 4 newest/)).toBeTruthy();
  });

  it("counts only the samples that are sent, and names the cap", async () => {
    stub({ samples: overflowing });
    render(<VoiceProfilePanel isAdmin={false} userId={ME} />);
    const summary = await screen.findByText(/into every chapter/);
    expect(summary.textContent).toContain("4 of your 5 samples go into every chapter");
    expect(summary.textContent).toContain("at most 4");
  });

  it("does not mark a switched-off sample as reaching a prompt", async () => {
    stub({ samples: [sample("a", false), sample("b", true)] });
    render(<VoiceProfilePanel isAdmin={false} userId={ME} />);
    await screen.findByText(/into every chapter/);
    expect(within(row(1)).getByText("Off")).toBeTruthy();
    expect(within(row(2)).getByText("In every chapter")).toBeTruthy();
  });
});

// ── Rule 2: a failure lands against the row it was about ──────────────────────

describe("switching a sample on and off", () => {
  it("PATCHes the row it was clicked on", async () => {
    stub({ samples: [sample("a", false), sample("b", false)] });
    render(<VoiceProfilePanel isAdmin={false} userId={ME} />);
    await screen.findByText(/into every chapter|No samples yet/);
    fireEvent.click(within(row(2)).getByRole("checkbox"));
    await waitFor(() => {
      const [url, init] = writes("PATCH")[0] as [string, RequestInit];
      expect(String(url)).toContain("/story-voice/samples/b");
      expect(String(init.body)).toContain('"enabled":true');
    });
  });

  it("reports a refused switch against that row, and leaves the others clean", async () => {
    stub({ samples: [sample("a", false), sample("b", false)] }, () => json({ error: "no" }, 404));
    render(<VoiceProfilePanel isAdmin={false} userId={ME} />);
    await screen.findByText(/into every chapter|No samples yet/);
    fireEvent.click(within(row(2)).getByRole("checkbox"));

    await waitFor(() => {
      expect(within(row(2)).getByRole("alert").textContent).toContain("Couldn't change that");
    });
    expect(within(row(1)).queryByRole("alert")).toBeNull();
  });

  // Found by mutation: swapping the CATCH branch's per-row message for a
  // panel-level one left every test green, because every other case here fails
  // with an HTTP status rather than by throwing.
  it("reports a dropped connection against that row too", async () => {
    stub({ samples: [sample("a", false), sample("b", false)] }, () => {
      throw new Error("network down");
    });
    render(<VoiceProfilePanel isAdmin={false} userId={ME} />);
    await screen.findByText(/into every chapter|No samples yet/);
    fireEvent.click(within(row(2)).getByRole("checkbox"));
    await waitFor(() => {
      expect(within(row(2)).getByRole("alert").textContent).toContain("Couldn't change that");
    });
    expect(within(row(1)).queryByRole("alert")).toBeNull();
  });

  it("leaves the checkbox where it was when the switch was refused", async () => {
    stub({ samples: [sample("a", false)] }, () => json({ error: "no" }, 404));
    render(<VoiceProfilePanel isAdmin={false} userId={ME} />);
    await screen.findByText(/into every chapter|No samples yet/);
    const box = within(row(1)).getByRole("checkbox") as HTMLInputElement;
    fireEvent.click(box);
    await waitFor(() => expect(within(row(1)).getByRole("alert")).toBeTruthy());
    // The message says it was left as it was; the box has to agree.
    expect(box.checked).toBe(false);
  });
});

// ── Requirement B: delete has to be reachable, and has to ask ─────────────────

describe("deleting a sample", () => {
  it("does not delete on the first click", async () => {
    stub({ samples: [sample("a", true)] });
    render(<VoiceProfilePanel isAdmin={false} userId={ME} />);
    await screen.findByText(/into every chapter/);
    fireEvent.click(within(row(1)).getByRole("button", { name: "Delete" }));
    expect(within(row(1)).getByText(/can't be undone/)).toBeTruthy();
    expect(writes("DELETE")).toHaveLength(0);
  });

  it("deletes once the advisor confirms", async () => {
    stub({ samples: [sample("a", true)] });
    render(<VoiceProfilePanel isAdmin={false} userId={ME} />);
    await screen.findByText(/into every chapter/);
    fireEvent.click(within(row(1)).getByRole("button", { name: "Delete" }));
    fireEvent.click(within(row(1)).getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => {
      expect(String(writes("DELETE")[0][0])).toContain("/story-voice/samples/a");
    });
  });

  it("backs out without deleting", async () => {
    stub({ samples: [sample("a", true)] });
    render(<VoiceProfilePanel isAdmin={false} userId={ME} />);
    await screen.findByText(/into every chapter/);
    fireEvent.click(within(row(1)).getByRole("button", { name: "Delete" }));
    fireEvent.click(within(row(1)).getByRole("button", { name: "Keep it" }));
    expect(within(row(1)).queryByText(/can't be undone/)).toBeNull();
    expect(writes("DELETE")).toHaveLength(0);
  });

  it("reports a refused delete against that row and keeps the confirmation open", async () => {
    stub({ samples: [sample("a", true)] }, (_url, init) =>
      init.method === "DELETE" ? json({ error: "no" }, 404) : json({ ok: true }),
    );
    render(<VoiceProfilePanel isAdmin={false} userId={ME} />);
    await screen.findByText(/into every chapter/);
    fireEvent.click(within(row(1)).getByRole("button", { name: "Delete" }));
    fireEvent.click(within(row(1)).getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => {
      expect(within(row(1)).getByRole("alert").textContent).toContain("Couldn't delete");
    });
    expect(within(row(1)).getByRole("button", { name: "Delete permanently" })).toBeTruthy();
  });
});

// ── Requirement A + rule 3: refusals that name their cause, boxes that keep ───
//    the typed words

describe("writing a sample by hand", () => {
  const TOO_LONG = "x".repeat(VOICE_TEXT_MAX + 500);
  const refusesText = () =>
    json({ error: "Validation failed", issues: [{ path: "text", message: "Too big" }] }, 400);

  it("names the actual cause and the actual limit when the text is too long", async () => {
    stub({ samples: [] }, refusesText);
    render(<VoiceProfilePanel isAdmin={false} userId={ME} />);
    await screen.findByText(/No samples yet/);
    fireEvent.change(screen.getByLabelText(/Write a sample/), { target: { value: TOO_LONG } });
    fireEvent.click(screen.getByRole("button", { name: "Save sample" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("2,500 characters");
    expect(alert.textContent).toContain("at most 2,000");
  });

  it("leaves the typed words in the box when the save was refused", async () => {
    stub({ samples: [] }, refusesText);
    render(<VoiceProfilePanel isAdmin={false} userId={ME} />);
    await screen.findByText(/No samples yet/);
    const box = screen.getByLabelText(/Write a sample/) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: TOO_LONG } });
    fireEvent.click(screen.getByRole("button", { name: "Save sample" }));
    await screen.findByRole("alert");
    expect(box.value).toBe(TOO_LONG);
  });

  it("clears the box and says the sample is off until it is switched on", async () => {
    stub({ samples: [] });
    render(<VoiceProfilePanel isAdmin={false} userId={ME} />);
    await screen.findByText(/No samples yet/);
    const box = screen.getByLabelText(/Write a sample/) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "A passage in my own words, long enough." } });
    fireEvent.click(screen.getByRole("button", { name: "Save sample" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("off until you"));
    expect(box.value).toBe("");
  });

  it("POSTs the words without a source client — nothing to scrub against", async () => {
    stub({ samples: [] });
    render(<VoiceProfilePanel isAdmin={false} userId={ME} />);
    await screen.findByText(/No samples yet/);
    fireEvent.change(screen.getByLabelText(/Write a sample/), {
      target: { value: "A passage in my own words, long enough." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save sample" }));
    await waitFor(() => {
      const body = String((writes("POST")[0][1] as RequestInit).body);
      expect(body).toContain("A passage in my own words");
      expect(body).not.toContain("sourceClientId");
    });
  });
});

// ── The style note, and which of the two rows it is about to overwrite ────────

describe("the style note", () => {
  it("warns an advisor reading the firm's note that they have none of their own", async () => {
    stub({ profile: { advisorUserId: "", styleNote: "House style." }, samples: [] });
    render(<VoiceProfilePanel isAdmin={false} userId={ME} />);
    expect(await screen.findByText(/reading your firm's default note/)).toBeTruthy();
  });

  it("says nothing about the firm when the note is the advisor's own", async () => {
    stub({ profile: { advisorUserId: ME, styleNote: "Mine." }, samples: [] });
    render(<VoiceProfilePanel isAdmin={false} userId={ME} />);
    await screen.findByDisplayValue("Mine.");
    expect(screen.queryByText(/reading your firm's default note/)).toBeNull();
  });

  it("PUTs the note against the advisor's own row by default", async () => {
    stub({ profile: null, samples: [] });
    render(<VoiceProfilePanel isAdmin={false} userId={ME} />);
    await screen.findByText(/haven't written a style note/);
    fireEvent.change(screen.getByLabelText(/Style note/), { target: { value: "Short sentences." } });
    fireEvent.click(screen.getByRole("button", { name: "Save style note" }));
    await waitFor(() => {
      const body = String((writes("PUT")[0][1] as RequestInit).body);
      expect(body).toContain("Short sentences.");
      expect(body).toContain('"firmDefault":false');
    });
  });

  it("keeps the typed note in the box when the save was refused", async () => {
    stub({ profile: null, samples: [] }, () => json({ error: "no" }, 403));
    render(<VoiceProfilePanel isAdmin={false} userId={ME} />);
    await screen.findByText(/haven't written a style note/);
    const box = screen.getByLabelText(/Style note/) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Short sentences." } });
    fireEvent.click(screen.getByRole("button", { name: "Save style note" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("still in the box"));
    expect(box.value).toBe("Short sentences.");
  });
});

// ── The firm-default flag is an admin affordance ──────────────────────────────

describe("the firm-default checkboxes", () => {
  it("are absent for a member", async () => {
    stub({ samples: [] });
    render(<VoiceProfilePanel isAdmin={false} userId={ME} />);
    await screen.findByText(/No samples yet/);
    expect(screen.queryByLabelText(/firm default/i)).toBeNull();
    expect(screen.queryByLabelText(/whole firm/i)).toBeNull();
  });

  it("send firmDefault true for an admin who ticks one", async () => {
    stub({ profile: null, samples: [] });
    render(<VoiceProfilePanel isAdmin userId={ME} />);
    await screen.findByText(/No samples yet/);
    fireEvent.click(screen.getByLabelText(/Save as the firm default/));
    fireEvent.change(screen.getByLabelText(/Style note/), { target: { value: "House style." } });
    fireEvent.click(screen.getByRole("button", { name: "Save style note" }));
    await waitFor(() => {
      expect(String((writes("PUT")[0][1] as RequestInit).body)).toContain('"firmDefault":true');
    });
  });
});

// ── The stored text is what the model gets, shown as stored ───────────────────

describe("what a row shows", () => {
  it("renders the stored text, and labels where it came from", async () => {
    stub({
      samples: [sample("a", true, { sourceChapterId: "planInOnePage", text: "Their plan holds." })],
    });
    render(<VoiceProfilePanel isAdmin={false} userId={ME} />);
    await screen.findByText(/into every chapter/);
    expect(within(row(1)).getByText("Their plan holds.")).toBeTruthy();
    // The heading comes off the live chapter registry, not a second list here.
    expect(within(row(1)).getByText(/Your plan, in one page/)).toBeTruthy();
  });

  it("names a sample the whole firm sends", async () => {
    stub({ samples: [sample("a", true, { firmDefault: true })] });
    render(<VoiceProfilePanel isAdmin={false} userId={ME} />);
    await screen.findByText(/into every chapter/);
    expect(within(row(1)).getByText(/Shared with your firm/)).toBeTruthy();
  });
});
