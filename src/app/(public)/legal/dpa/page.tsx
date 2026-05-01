import Link from "next/link";
import LegalPage from "../LegalPage";

export const metadata = {
  title: "Data Processing Addendum — Foundry Planning",
  robots: { index: true, follow: true },
};

export default function DpaPage() {
  return (
    <LegalPage
      eyebrow="05 · Data processing"
      title="Data Processing Addendum"
      lastUpdated="May 1, 2026"
    >
      <section>
        <h2>1. Scope and roles</h2>
        <p>
          This Addendum forms part of the agreement between Foundry
          Planning, Inc. (&ldquo;Foundry,&rdquo; &ldquo;Processor&rdquo;)
          and the Firm identified at sign-up (&ldquo;Firm,&rdquo;
          &ldquo;Controller&rdquo;) and governs Foundry's processing of
          personal information about the Firm's clients (&ldquo;Client
          Data&rdquo;) on the Firm's behalf. Where Foundry processes
          personal information about Firm members directly, Foundry acts
          as Controller; that processing is described in our{" "}
          <Link href="/legal/privacy">Privacy Policy</Link>.
        </p>
      </section>

      <section>
        <h2>2. Subject matter, duration, and nature of processing</h2>
        <ul>
          <li>
            <strong>Subject matter:</strong> processing required to
            provide the Service to the Firm.
          </li>
          <li>
            <strong>Duration:</strong> the term of the Firm's
            subscription, plus any read-only grace and retention windows
            described in our{" "}
            <Link href="/legal/privacy">Privacy Policy</Link>.
          </li>
          <li>
            <strong>Nature and purpose:</strong> storing, organizing,
            projecting, modelling, and rendering reports on Client Data
            uploaded or entered by the Firm.
          </li>
          <li>
            <strong>Categories of data subjects:</strong> the Firm's
            clients and their household members named in scenarios.
          </li>
          <li>
            <strong>Categories of data:</strong> identity, demographics,
            household composition, financial accounts, income, expenses,
            tax history, estate documents, and any other content the Firm
            uploads.
          </li>
        </ul>
      </section>

      <section>
        <h2>3. Foundry's obligations</h2>
        <ul>
          <li>
            Process Client Data only on documented instructions from the
            Firm (the agreement and these Terms).
          </li>
          <li>
            Ensure that personnel with access to Client Data are bound by
            confidentiality.
          </li>
          <li>
            Implement and maintain the security measures listed in
            Section&nbsp;5.
          </li>
          <li>
            Assist the Firm, taking into account the nature of processing,
            in responding to data-subject requests and to data-protection
            authorities.
          </li>
          <li>
            Notify the Firm without undue delay (target: within 72 hours of
            confirmation) of any confirmed personal-data breach affecting
            Client Data.
          </li>
        </ul>
      </section>

      <section>
        <h2>4. Subprocessors</h2>
        <p>
          The Firm authorizes Foundry's use of the subprocessors listed at{" "}
          <a
            href="https://github.com/foundry-planning/foundry-planning/blob/main/docs/vendors.md"
            rel="noopener"
          >
            docs/vendors.md
          </a>
          . Foundry will provide at least 30 days' prior written notice
          (to the Firm owner of record) before adding or replacing a
          subprocessor that processes Client Data, during which the Firm
          may object on reasonable grounds. Foundry imposes data-protection
          obligations on its subprocessors that are no less protective than
          those in this Addendum.
        </p>
      </section>

      <section>
        <h2>5. Security measures</h2>
        <ul>
          <li>
            <strong>Encryption:</strong> TLS 1.2+ in transit; AES-256 at
            rest via Neon-managed Postgres.
          </li>
          <li>
            <strong>Access control:</strong> three-tier roles
            (owner/admin/member) enforced server-side; multi-factor
            authentication required for owner role.
          </li>
          <li>
            <strong>Tenancy isolation:</strong> all Client Data queries
            scoped by Firm ID at the application layer; verified by tests.
          </li>
          <li>
            <strong>Audit logging:</strong> security-relevant actions are
            recorded in an append-only audit log retained for seven years.
          </li>
          <li>
            <strong>Vulnerability management:</strong> dependency scanning
            on every build, security review of merge-bound changes,
            time-bound triage of disclosed vulnerabilities.
          </li>
          <li>
            <strong>Incident response:</strong> documented runbook with
            on-call rotation; alerts via Sentry and infrastructure
            monitoring.
          </li>
        </ul>
      </section>

      <section>
        <h2>6. International data transfers</h2>
        <p>
          Where Client Data is transferred from the European Economic
          Area, United Kingdom, or Switzerland to a country not deemed
          adequate, the parties agree that the Standard Contractual Clauses
          (Module Two: Controller-to-Processor) are incorporated by
          reference, with the optional docking clause selected, governing
          law of Ireland, and supervisory authority of Ireland. The UK
          International Data Transfer Addendum and the Swiss FDPIC
          guidance apply mutatis mutandis.
        </p>
      </section>

      <section>
        <h2>7. Audits and information requests</h2>
        <p>
          Foundry will provide the Firm with up-to-date attestations
          (current SOC&nbsp;2 Type&nbsp;II report or equivalent) and
          reasonable cooperation with the Firm's audit obligations under
          applicable law, on no more than annual basis or as required by
          regulators or after a confirmed incident.
        </p>
      </section>

      <section>
        <h2>8. Return and deletion</h2>
        <p>
          On termination or expiry, Foundry will delete Client Data in
          accordance with the retention policy in our{" "}
          <Link href="/legal/privacy">Privacy Policy</Link>. The Firm may
          export its data through the Service during the read-only grace
          window. After deletion, Foundry will, on request, provide a
          written confirmation that deletion has occurred, subject to any
          legal obligation to retain copies.
        </p>
      </section>

      <section>
        <h2>9. Liability</h2>
        <p>
          The liability of each party under or in connection with this
          Addendum is subject to the limits of liability in the
          agreement.
        </p>
      </section>

      <section>
        <h2>10. Order of precedence</h2>
        <p>
          If there is a conflict between this Addendum and any other terms
          between the parties, this Addendum governs solely with respect
          to processing of Client Data.
        </p>
      </section>

      <section>
        <h2>11. Contact</h2>
        <p>
          Privacy and security questions:{" "}
          <a href="mailto:support@foundryplanning.com">
            support@foundryplanning.com
          </a>
          .
        </p>
      </section>
    </LegalPage>
  );
}
