"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { inputClassName, fieldLabelClassName } from "@/components/forms/input-styles";

type Status = "connected" | "disconnected" | "error";

interface Props {
  status: Status;
  endpoint: string | null;
  chatDeployment: string | null;
  connectedAt: string | null;
}

// Deliberately local, NOT imported from `@/lib/ai/verify-connection`'s
// `ConnectionCheck` — that module transitively pulls in `@clerk/nextjs/server`
// and the DB connections module via `./resolve`, and this is a "use client"
// component. Importing from it (even `import type`, if anyone is tempted to
// "helpfully" DRY this) would drag server-only code into the client bundle.
type Check = { name: "chat" | "mini" | "embedding"; ok: boolean; detail?: string };

const CHECK_LABEL: Record<Check["name"], string> = {
  chat: "Main model",
  mini: "Fast model",
  embedding: "Search model",
};

const DEFAULTS = {
  apiVersion: "2024-12-01-preview",
  chatDeployment: "gpt-5.4",
  miniDeployment: "gpt-5.4-mini",
  embeddingDeployment: "text-embedding-3-small",
};

/**
 * Numbered Azure setup steps, shown inline where the firm connects. Two things
 * this copy MUST keep saying, because getting them wrong misleads the exact
 * buyer this feature is for:
 *  1. Zero data retention needs Microsoft's approval, which goes to customers
 *     managed by a Microsoft account team (in practice, Enterprise Agreement /
 *     Microsoft Customer Agreement customers) OR to firms under an eligible
 *     program — everyone else may apply, with no promise of access, so a
 *     pay-as-you-go firm should assume it does not have this. By default Azure
 *     temporarily stores prompts and reviews them primarily by automated
 *     systems, with human review only when automated review can't reach a
 *     confident determination — which is WEAKER than Foundry Planning's
 *     current posture (zero retention today).
 *
 *     Three ways this sentence has already gone wrong, so: do not restate a
 *     specific day count (Microsoft dropped the published figure in an Oct 2025
 *     revision); do not call human review the default (its current text says
 *     flagged content is sampled by automated means "instead of a human
 *     reviewer"); do not say what APPROVAL DELIVERS — the quoted text goes as
 *     far as "apply to modify abuse monitoring" and no further, and "zero data
 *     retention"/"ZDR" is blog wording Microsoft's docs never use, so an
 *     "unless approved" carve-out on the storing sentence is a promise we
 *     cannot keep; and do not drop the "or under an eligible program" disjunct
 *     to write a flat "only managed customers". (Foundry Planning's OWN zero
 *     retention above is a claim about our product, it is true, and it stays.)
 *     Microsoft's own quoted text is
 *     the authority here — NOT the paraphrases in the plan's
 *     ms-docs-verification.md, whose suggested wording is what dropped that
 *     disjunct in the first place.
 *  2. Microsoft's portal is now called "Microsoft Foundry", which collides with
 *     our product name. Never let "Foundry" stand alone in an Azure step.
 */
function SetupSteps() {
  return (
    <details className="rounded-lg border border-hair bg-card-2 p-3">
      <summary className="cursor-pointer text-sm font-medium text-ink">
        Set up in Azure — 8 steps
      </summary>
      <ol className="mt-3 flex list-decimal flex-col gap-3 pl-5 text-sm text-ink-2">
        <li>
          <span className="font-medium text-ink">Check what retention you can get.</span>{" "}
          Azure temporarily stores prompts for abuse monitoring by default &mdash; reviewed
          primarily by automated systems, with human review only when automated review
          can&rsquo;t reach a confident determination. Changing that takes Microsoft&rsquo;s
          approval of your subscription for Modified Abuse Monitoring. That approval goes
          only to customers managed by a Microsoft account team &mdash; in practice,
          Enterprise Agreement or Microsoft Customer Agreement customers &mdash; or to firms
          under an eligible program.{" "}
          <span className="font-medium text-ink">
            Assume you do not have it on pay-as-you-go
          </span>
          : Microsoft invites everyone else to apply on the same form and says it will
          follow up about joining a program, but promises nothing beyond the follow-up.
          Without that approval, connecting your own Azure gives you weaker retention than
          Foundry Planning&rsquo;s current setup, which already has zero retention.
        </li>
        <li>
          <span className="font-medium text-ink">Confirm Azure access.</span> You need an Azure
          subscription and someone with rights to create resources — usually IT, not an advisor.
        </li>
        <li>
          <span className="font-medium text-ink">Create an Azure OpenAI resource</span> in
          Microsoft Foundry (Azure&rsquo;s portal). Pick the region deliberately: it decides where
          your client data is processed.
        </li>
        <li>
          <span className="font-medium text-ink">Register if Azure prompts you to.</span>{" "}
          Some models gate on a one-time registration: Microsoft lists gpt-5 and gpt-5-codex
          as gated, and gpt-5-mini, gpt-5-nano and gpt-5-chat as not.
          Microsoft&rsquo;s stated turnaround is 5&ndash;10 business days.
        </li>
        <li>
          <span className="font-medium text-ink">Deploy three models</span> and keep these names,
          or note whatever you use:
          <ul className="mt-1 list-disc pl-5">
            <li><code>{DEFAULTS.chatDeployment}</code> — reads documents and drafts</li>
            <li><code>{DEFAULTS.miniDeployment}</code> — quick summaries</li>
            <li><code>{DEFAULTS.embeddingDeployment}</code> — powers Forge search</li>
          </ul>
          The search model must be this one. A different embedding model returns results that
          look fine and are unrelated, so we check it before connecting.
        </li>
        <li>
          <span className="font-medium text-ink">Check your quota tier.</span> Azure assigns
          every subscription an automatic Quota Tier (0&ndash;6) that sets your throughput.
          At Tier 1, a GPT-5-family chat model gets 300,000 tokens per minute by default on a
          DataZoneStandard deployment and 1,000,000 on a GlobalStandard one — enough for a
          long statement&rsquo;s many parallel calls. The{" "}
          <span className="font-medium text-ink">Free Tier lists only four models</span>, and
          the two chat deployments above are not among them — a firm still on it needs a
          quota-increase request, or enough usage to trigger an automatic tier upgrade,
          before it can deploy them.
        </li>
        <li>
          <span className="font-medium text-ink">Apply for Modified Abuse Monitoring</span> if
          your compliance policy will not accept prompts being stored for abuse monitoring.
          Approval modifies that monitoring for your subscription; what it changes is between
          your firm and Microsoft, so get the terms from them before you rely on it. You apply
          by completing Microsoft&rsquo;s form, and it is the same form whether or not you are
          a managed customer. If you have a Microsoft account team, ask them first; if you do
          not, submit it yourself.
        </li>
        <li>
          <span className="font-medium text-ink">Copy your endpoint and one API key</span> from
          the resource&rsquo;s Keys and Endpoint page, paste them below, and press Test connection.
        </li>
      </ol>
    </details>
  );
}

export function AzureOpenAiCard({ status, endpoint, chatDeployment, connectedAt }: Props) {
  const router = useRouter();
  const { showToast } = useToast();

  const [form, setForm] = useState({ endpoint: "", apiKey: "", ...DEFAULTS });
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState<"test" | "connect" | "disconnect" | null>(null);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [tested, setTested] = useState(false);

  // Any credential edit invalidates the last test result, so a stale pass can
  // never authorize different credentials.
  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((f) => ({ ...f, [field]: e.target.value }));
      setTested(false);
      setChecks(null);
    };
  }

  async function post(path: "test" | "connect", body: Record<string, unknown>) {
    const res = await fetch(`/api/integrations/azure_openai/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: string; checks?: Check[] }
      | null;
    return { httpOk: res.ok, data };
  }

  // The reset lives in `finally`: a rejected fetch (network down, DNS, an
  // aborted navigation) would otherwise throw past `setBusy(null)` and leave
  // `busy === "test"` forever, which disables Test connection, Connect and
  // every way back — the card would be dead until the page reloads.
  async function handleTest() {
    setBusy("test");
    try {
      const { httpOk, data } = await post("test", form);
      setChecks(data?.checks ?? null);
      setTested(httpOk && data?.ok === true);
      if (!httpOk && !data?.checks) {
        showToast({ message: data?.error ?? "Couldn't reach Azure with those details." });
      }
    } catch {
      setChecks(null);
      setTested(false);
      showToast({ message: "Couldn't reach Azure with those details." });
    } finally {
      setBusy(null);
    }
  }

  async function handleConnect(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy("connect");
    try {
      // `attestation` is the advisor's actual answer, never a literal — the
      // server persists it as a compliance record.
      const { httpOk, data } = await post("connect", { ...form, attestation: attested });
      if (httpOk) {
        showToast({ message: "Azure OpenAI connected." });
        router.refresh();
      } else {
        setChecks(data?.checks ?? null);
        showToast({ message: data?.error ?? "Couldn't connect Azure OpenAI." });
      }
    } catch {
      showToast({ message: "Couldn't connect Azure OpenAI." });
    } finally {
      setBusy(null);
    }
  }

  async function handleDisconnect() {
    setBusy("disconnect");
    try {
      const res = await fetch("/api/integrations/azure_openai/disconnect", { method: "POST" });
      if (!res.ok) throw new Error("disconnect failed");
      router.refresh();
    } catch {
      showToast({ message: "Couldn't disconnect. Please try again." });
    } finally {
      setBusy(null);
    }
  }

  const incomplete = !form.endpoint.trim() || !form.apiKey.trim();
  const canConnect = attested && tested && busy === null;

  if (status === "connected") {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-hair p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink">Azure OpenAI</h2>
          <span className="inline-flex items-center gap-2 text-sm text-ink-2">
            <span className="h-2 w-2 rounded-full bg-good" aria-hidden="true" />
            Connected
          </span>
        </div>
        <p className="text-sm text-ink">
          Foundry Planning&rsquo;s AI runs in your own Azure tenant. Documents, drafts and
          Forge all use the resource below, under your firm&rsquo;s agreement with Microsoft.
        </p>
        <dl className="grid gap-1 text-sm text-ink-2 sm:grid-cols-2">
          <div><dt className="inline text-ink-3">Endpoint: </dt><dd className="inline">{endpoint}</dd></div>
          <div><dt className="inline text-ink-3">Main model: </dt><dd className="inline">{chatDeployment}</dd></div>
          {connectedAt ? (
            <div>
              <dt className="inline text-ink-3">Connected: </dt>
              <dd className="tabular inline">
                {new Date(connectedAt).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </dd>
            </div>
          ) : null}
        </dl>
        <p className="text-sm text-ink-3">
          Connecting changed where future AI work happens. It does not move work already done.
        </p>
        <div>
          <button
            type="button"
            className="btn-ghost text-sm"
            onClick={handleDisconnect}
            disabled={busy !== null}
          >
            {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-hair p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink">Azure OpenAI</h2>
        <span className="inline-flex items-center gap-2 text-sm text-ink-2">
          <span
            className={`h-2 w-2 rounded-full ${status === "error" ? "bg-warn" : "bg-ink-4"}`}
            aria-hidden="true"
          />
          {status === "error" ? "Reconnect needed" : "Not connected"}
        </span>
      </div>

      {status === "error" ? (
        <p className="text-sm text-ink-3">
          Foundry Planning can no longer reach your Azure resource, so AI features are
          paused. They will not fall back to Foundry Planning&rsquo;s own AI — reconnect
          below to resume.
        </p>
      ) : (
        <p className="text-sm text-ink-3">
          Run Foundry Planning&rsquo;s AI inside your firm&rsquo;s own Azure tenant, under
          your own agreement with Microsoft. Advisors see no difference; your compliance
          team does.
        </p>
      )}

      <SetupSteps />

      <form className="flex flex-col gap-3" onSubmit={handleConnect}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="azure-endpoint" className={fieldLabelClassName}>Azure endpoint</label>
            <input
              id="azure-endpoint"
              className={inputClassName}
              type="url"
              value={form.endpoint}
              onChange={set("endpoint")}
              placeholder="https://your-resource.openai.azure.com"
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="azure-api-key" className={fieldLabelClassName}>API key</label>
            <input
              id="azure-api-key"
              className={inputClassName}
              type="password"
              value={form.apiKey}
              onChange={set("apiKey")}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="azure-chat" className={fieldLabelClassName}>Main model deployment</label>
            <input id="azure-chat" className={inputClassName} value={form.chatDeployment} onChange={set("chatDeployment")} required />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="azure-mini" className={fieldLabelClassName}>Fast model deployment</label>
            <input id="azure-mini" className={inputClassName} value={form.miniDeployment} onChange={set("miniDeployment")} required />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="azure-embed" className={fieldLabelClassName}>Search model deployment</label>
            <input id="azure-embed" className={inputClassName} value={form.embeddingDeployment} onChange={set("embeddingDeployment")} required />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="azure-version" className={fieldLabelClassName}>API version</label>
            <input id="azure-version" className={inputClassName} value={form.apiVersion} onChange={set("apiVersion")} required />
          </div>
        </div>

        {checks ? (
          <ul className="flex flex-col gap-1 text-sm">
            {checks.map((c) => (
              <li key={c.name} className={c.ok ? "text-good" : "text-crit"}>
                {c.ok ? "✓" : "✗"} {CHECK_LABEL[c.name]}
                {c.detail ? ` — ${c.detail}` : ""}
              </li>
            ))}
          </ul>
        ) : null}

        <label htmlFor="azure-attestation" className="flex items-start gap-2 text-sm text-ink-2">
          <input
            id="azure-attestation"
            type="checkbox"
            className="mt-0.5"
            checked={attested}
            onChange={(e) => setAttested(e.target.checked)}
          />
          I understand that Azure temporarily stores prompts for abuse monitoring by default
          &mdash; reviewed primarily by automated systems, with human review only when
          automated review can&rsquo;t reach a confident determination &mdash; and that any
          change to that takes Microsoft&rsquo;s separate approval of my firm for Modified
          Abuse Monitoring. I am authorized to connect this resource.
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn-ghost text-sm"
            onClick={handleTest}
            disabled={incomplete || busy !== null}
          >
            {busy === "test" ? "Testing…" : "Test connection"}
          </button>
          <button type="submit" className="btn-primary text-sm" disabled={!canConnect}>
            {busy === "connect" ? "Connecting…" : "Connect"}
          </button>
        </div>
      </form>
    </div>
  );
}
