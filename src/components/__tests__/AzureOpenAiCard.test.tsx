// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AzureOpenAiCard } from "../AzureOpenAiCard";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

function fill() {
  fireEvent.change(screen.getByLabelText(/Azure endpoint/i), {
    target: { value: "https://acme-ria.openai.azure.com" },
  });
  fireEvent.change(screen.getByLabelText(/API key/i), { target: { value: "firm-key" } });
}

/**
 * Real assertion for "Foundry never stands alone" (R29 / constraint 8):
 * collects every bare "Foundry" occurrence in the rendered text — one not
 * preceded by "Microsoft " (Azure's portal) or followed by " Planning" (our
 * product) — and returns them with surrounding context. A caller asserts
 * `toEqual([])`, so a failure names the offending snippet instead of a loop
 * whose body never checks its own match.
 */
function foundryViolations(text: string): string[] {
  const violations: string[] = [];
  const re = /Foundry/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const start = match.index;
    const before = text.slice(Math.max(0, start - 10), start);
    const after = text.slice(start + "Foundry".length, start + "Foundry".length + 9);
    const qualified = before.endsWith("Microsoft ") || after.startsWith(" Planning");
    if (!qualified) {
      violations.push(text.slice(Math.max(0, start - 20), start + 30));
    }
  }
  return violations;
}

describe("AzureOpenAiCard — disconnected", () => {
  it("shows the Azure setup steps", () => {
    render(<AzureOpenAiCard status="disconnected" endpoint={null} chatDeployment={null} connectedAt={null} />);
    expect(screen.getByText(/Set up in Azure/i)).toBeTruthy();
  });

  it("names Azure's portal as Microsoft Foundry on first use", () => {
    const { container } = render(
      <AzureOpenAiCard status="disconnected" endpoint={null} chatDeployment={null} connectedAt={null} />,
    );
    expect(container.textContent ?? "").toMatch(/Microsoft Foundry \(Azure/);
  });

  it("never lets 'Foundry' stand alone anywhere in the card", () => {
    const { container } = render(
      <AzureOpenAiCard status="disconnected" endpoint={null} chatDeployment={null} connectedAt={null} />,
    );
    expect(foundryViolations(container.textContent ?? "")).toEqual([]);
  });

  it("promises as many setup steps in the summary as it renders", () => {
    const { container } = render(
      <AzureOpenAiCard status="disconnected" endpoint={null} chatDeployment={null} connectedAt={null} />,
    );
    // Step 5 nests a <ul> of three model names, so count the <ol>'s DIRECT
    // children — querySelectorAll("li") would return 11.
    const steps = Array.from(container.querySelector("ol")?.children ?? []).filter(
      (el) => el.tagName === "LI",
    );
    const promised = /(\d+)\s+steps/.exec(container.querySelector("summary")?.textContent ?? "");
    expect(steps.length).toBe(8);
    expect(Number(promised?.[1])).toBe(steps.length);
  });

  it("keeps Connect disabled until a test passes", async () => {
    render(<AzureOpenAiCard status="disconnected" endpoint={null} chatDeployment={null} connectedAt={null} />);
    fill();
    expect(screen.getByRole("button", { name: /^Connect$/i })).toHaveProperty("disabled", true);

    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, checks: [] }) });
    fireEvent.click(screen.getByRole("button", { name: /Test connection/i }));
    fireEvent.click(screen.getByLabelText(/I understand/i));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Connect$/i })).toHaveProperty("disabled", false),
    );
  });

  it("invalidates a passed test when a credential changes", async () => {
    render(<AzureOpenAiCard status="disconnected" endpoint={null} chatDeployment={null} connectedAt={null} />);
    fill();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, checks: [] }) });
    fireEvent.click(screen.getByRole("button", { name: /Test connection/i }));
    fireEvent.click(screen.getByLabelText(/I understand/i));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Connect$/i })).toHaveProperty("disabled", false),
    );

    fireEvent.change(screen.getByLabelText(/API key/i), { target: { value: "different" } });

    expect(screen.getByRole("button", { name: /^Connect$/i })).toHaveProperty("disabled", true);
  });

  it("shows each failed check by name", async () => {
    const { container } = render(
      <AzureOpenAiCard status="disconnected" endpoint={null} chatDeployment={null} connectedAt={null} />,
    );
    fill();
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({
        ok: false,
        checks: [
          { name: "chat", ok: true },
          { name: "mini", ok: true },
          { name: "embedding", ok: false, detail: "different model from the planning library" },
        ],
      }),
    });
    fireEvent.click(screen.getByRole("button", { name: /Test connection/i }));

    // The labels are the only thing telling a firm WHICH deployment to fix.
    // ONE regex across all three rendered rows, in the fixture's array order
    // (chat, mini, embedding) — three separate matches would be an unordered
    // set, and a chat <-> mini swap would satisfy it. Only the failing row is
    // bound to a label by its detail string; the passing pair needs the order.
    // The tick/cross prefixes also scope this to the results list, whose rows
    // render adjacent, since the form's field labels repeat the same words.
    await waitFor(() =>
      expect(container.textContent ?? "").toMatch(
        /✓ Main model✓ Fast model✗ Search model — different model from the planning library/,
      ),
    );
  });

  it("frees the card again when the connect request rejects outright", async () => {
    render(<AzureOpenAiCard status="disconnected" endpoint={null} chatDeployment={null} connectedAt={null} />);
    fill();
    // First call is the test (passes); every later call — the connect — rejects.
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, checks: [] }) });
    fetchMock.mockRejectedValue(new Error("network down"));
    fireEvent.click(screen.getByRole("button", { name: /Test connection/i }));
    fireEvent.click(screen.getByLabelText(/I understand/i));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Connect$/i })).toHaveProperty("disabled", false),
    );

    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));

    // Querying by accessible name is the point: a wedged card still reads
    // "Connecting…", so the QUERY fails, not merely the disabled assertion.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Connect$/i })).toHaveProperty("disabled", false);
      expect(screen.getByRole("button", { name: /^Test connection$/i })).toHaveProperty(
        "disabled",
        false,
      );
    });
  });

  it("sends the advisor's attestation with the connect request", async () => {
    render(<AzureOpenAiCard status="disconnected" endpoint={null} chatDeployment={null} connectedAt={null} />);
    fill();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, checks: [] }) });
    fireEvent.click(screen.getByRole("button", { name: /Test connection/i }));
    fireEvent.click(screen.getByLabelText(/I understand/i));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Connect$/i })).toHaveProperty("disabled", false),
    );

    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));

    // The attestation is a compliance record the server persists, so it has to
    // reach the wire — not just gate the button.
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/connect"));
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
        attestation: true,
        endpoint: "https://acme-ria.openai.azure.com",
      });
    });
  });

  it("frees the card again when the test request rejects outright", async () => {
    render(<AzureOpenAiCard status="disconnected" endpoint={null} chatDeployment={null} connectedAt={null} />);
    fill();
    // A rejected fetch (network down, DNS, aborted navigation) must not strand
    // the card on "Testing…" with every button disabled until a page reload.
    fetchMock.mockRejectedValue(new Error("network down"));
    fireEvent.click(screen.getByRole("button", { name: /Test connection/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Test connection$/i })).toHaveProperty(
        "disabled",
        false,
      ),
    );
  });
});

/**
 * Every factual Azure claim on this card was checked against Microsoft Learn
 * and recorded in the plan's `ms-docs-verification.md`. Microsoft has since
 * retired several of the claims earlier drafts made, and a firm that opens the
 * Azure portal and sees a claim here contradicted stops trusting the whole
 * card — so both halves matter: the retired wording must be gone, and the
 * corrected wording must actually be on screen.
 *
 * Read `container.textContent`, never `getByText`: each of these sentences is
 * split across a nested <span>, and `getByText` matches an element's own
 * direct text nodes, so the <li> and its <span> both match and the query
 * throws on ambiguity.
 */
describe("AzureOpenAiCard — Azure setup claims", () => {
  function cardText() {
    const { container } = render(
      <AzureOpenAiCard status="disconnected" endpoint={null} chatDeployment={null} connectedAt={null} />,
    );
    return container.textContent ?? "";
  }

  it("repeats no claim Microsoft has since retired", () => {
    const text = cardText();
    const retired = [
      // Microsoft dropped the published retention figure in Oct 2025.
      /\b30 days\b/,
      // Quota is auto-tiered now; there is no number you dial in on a form.
      /100,000 tokens/,
      // Microsoft's own figure is a 5-10 business day range.
      /about 10 business days/,
      // gpt-5 and gpt-5-codex are not the only gated models, and this card's
      // own gpt-5.4 defaults have no published registration status at all.
      /only GPT-5-family/i,
      // The Free Tier table does list gpt-5-mini.
      /zero quota for any GPT-5/i,
      // Microsoft's own sentence is "managed by a Microsoft account team OR
      // under an eligible program", and it invites everyone else to apply.
      /approval is available only to/,
      // The 300k-1M range spans two DEPLOYMENT TYPES, not a tier ladder, and
      // Microsoft states nothing at all about tiers 2-6.
      /Tier 1 and above/,
      /300,000–1,000,000 tokens per minute/,
      // Usage can also trigger an automatic tier upgrade; the form is not the
      // only way off the Free Tier.
      /quota-increase request before it can deploy them/,
      // Step 1 states a test now, not a verdict, so nothing there can have
      // "said you're eligible".
      /if step 1 said you’re eligible/,
      // Microsoft's quoted text says you apply by completing a form — it never
      // says a representative starts it, and telling a firm that shuts the
      // self-serve door step 1 opened.
      /account representative starts this/,
      // Step 7 gates on need. Any eligibility gate reads as "skip this step"
      // to a pay-as-you-go firm, which is who the rest of the step is for.
      /step 1’s test fits your firm/,
    ];
    // Collect, don't loop-and-assert: `expect` throws on the first failure, so
    // a loop would stop there and a second returned claim would never be
    // evaluated. Round 3 needed two half-mutations to work around exactly that.
    expect(retired.filter((claim) => claim.test(text)).map(String)).toEqual([]);
  });

  it("states the corrected retention and eligibility claims", () => {
    const text = cardText();

    // Abuse-monitoring review is automated by default; human review is the
    // exception. Both surfaces must say so — the step, and the sentence the
    // advisor actually attests to.
    const automatedReview =
      "temporarily stores prompts for abuse monitoring — reviewed primarily by automated " +
      "systems, with human review only when automated review can’t reach a confident determination";
    expect(text).toContain(
      `Check what retention you can get. Azure ${automatedReview} — unless Microsoft approves`,
    );
    expect(text).toContain(
      `I understand that Azure ${automatedReview} — unless my firm has been approved`,
    );

    // Eligibility carries BOTH of Microsoft's disjuncts, and the open door for
    // everyone else — while still telling a pay-as-you-go firm to assume no.
    expect(text).toContain(
      "That approval goes only to customers managed by a Microsoft account team — in practice, " +
        "Enterprise Agreement or Microsoft Customer Agreement customers — or to firms under an " +
        "eligible program. Assume you do not have it on pay-as-you-go: Microsoft invites " +
        "everyone else to apply on the same form and says it will follow up about joining a " +
        "program, but promises nothing beyond the follow-up.",
    );

    // The buyer warning itself. Asserting the whole sentence means deleting it
    // reddens, which the old bare /pay-as-you-go/ match did not.
    expect(text).toContain(
      "Without that approval, connecting your own Azure gives you weaker retention than " +
        "Foundry Planning’s current setup, which already has zero retention.",
    );
  });

  it("states the corrected registration and quota claims", () => {
    const text = cardText();

    // Registration is hedged the way Microsoft's own text hedges it.
    expect(text).toContain(
      "Some models gate on a one-time registration: Microsoft lists gpt-5 and gpt-5-codex as " +
        "gated, and gpt-5-mini, gpt-5-nano and gpt-5-chat as not.",
    );

    // Each throughput figure is attached to the deployment type it belongs to.
    expect(text).toContain(
      "At Tier 1, a GPT-5-family chat model gets 300,000 tokens per minute by default on a " +
        "DataZoneStandard deployment and 1,000,000 on a GlobalStandard one",
    );

    // The Free Tier's table, what it means for this card's own defaults, and
    // both ways off it.
    expect(text).toContain(
      "Free Tier lists only four models, and the two chat deployments above are not among them " +
        "— a firm still on it needs a quota-increase request, or enough usage to trigger an " +
        "automatic tier upgrade, before it can deploy them.",
    );
  });

  it("lists in step 5 exactly the deployments step 6 counts on", () => {
    const { container } = render(
      <AzureOpenAiCard status="disconnected" endpoint={null} chatDeployment={null} connectedAt={null} />,
    );
    // Step 6's "the two chat deployments above are not among them" is true only
    // while step 5 lists exactly these three — two chat models and one search
    // model. A fourth deployment, or a non-chat model in the pair, makes step 6
    // wrong with every copy assertion still green.
    const models = Array.from(container.querySelectorAll("ol ul > li")).map(
      (el) => el.textContent ?? "",
    );
    expect(models).toEqual([
      "gpt-5.4 — reads documents and drafts",
      "gpt-5.4-mini — quick summaries",
      "text-embedding-3-small — powers Forge search",
    ]);
  });

  it("keeps step 7's application route open to a firm with no account team", () => {
    const text = cardText();
    // Step 1 tells a pay-as-you-go firm Microsoft invites everyone else to
    // apply on the same form; step 7 is where they would act on that. So it
    // must not hand the process back to a representative they do not have,
    // and it must gate on NEED — any eligibility gate here reads as "skip
    // this step" to the very firm the next sentence is addressed to.
    expect(text).toContain(
      "Apply for Modified Abuse Monitoring if your compliance policy requires zero retention. " +
        "You apply by completing Microsoft’s form, and it is the same form whether or not you " +
        "are a managed customer. If you have a Microsoft account team, ask them first; if you " +
        "do not, submit it yourself.",
    );
  });
});

describe("AzureOpenAiCard — connected", () => {
  const props = {
    status: "connected" as const,
    endpoint: "https://acme-ria.openai.azure.com",
    chatDeployment: "gpt-5.4",
    connectedAt: "2026-08-27T12:00:00.000Z",
  };

  it("states plainly that AI runs in the firm's own tenant", () => {
    render(<AzureOpenAiCard {...props} />);
    expect(screen.getByText(/runs in your own Azure tenant/i)).toBeTruthy();
  });

  it("shows the endpoint and deployment but no key field", () => {
    render(<AzureOpenAiCard {...props} />);
    expect(screen.getByText(/acme-ria\.openai\.azure\.com/)).toBeTruthy();
    // The connected view does not render SetupSteps, so "gpt-5.4" here can
    // only be the deployment we passed in.
    expect(screen.getByText(/^gpt-5\.4$/)).toBeTruthy();
    expect(screen.queryByLabelText(/API key/i)).toBeNull();
  });

  it("says connecting is not retroactive", () => {
    render(<AzureOpenAiCard {...props} />);
    expect(screen.getByText(/does not move work already done/i)).toBeTruthy();
  });

  it("never lets 'Foundry' stand alone anywhere in the card", () => {
    const { container } = render(<AzureOpenAiCard {...props} />);
    expect(foundryViolations(container.textContent ?? "")).toEqual([]);
  });
});

describe("AzureOpenAiCard — error", () => {
  const props = {
    status: "error" as const,
    endpoint: "https://acme-ria.openai.azure.com",
    chatDeployment: "gpt-5.4",
    connectedAt: "2026-08-27T12:00:00.000Z",
  };

  it("shows a reconnect-needed status and that AI features are paused", () => {
    render(<AzureOpenAiCard {...props} />);
    expect(screen.getByText(/Reconnect needed/i)).toBeTruthy();
    expect(screen.getByText(/AI features are paused/i)).toBeTruthy();
  });

  it("promises no fallback to Foundry Planning's own AI", () => {
    render(<AzureOpenAiCard {...props} />);
    expect(screen.getByText(/will not fall back to Foundry Planning/i)).toBeTruthy();
  });

  it("never lets 'Foundry' stand alone anywhere in the card", () => {
    const { container } = render(<AzureOpenAiCard {...props} />);
    expect(foundryViolations(container.textContent ?? "")).toEqual([]);
  });
});
