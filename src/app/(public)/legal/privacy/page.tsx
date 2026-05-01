import Link from "next/link";
import LegalPage from "../LegalPage";

export const metadata = {
  title: "Privacy Policy — Foundry Planning",
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="04 · Privacy"
      title="Privacy Policy"
      lastUpdated="May 1, 2026"
    >
      <section>
        <h2>1. Scope</h2>
        <p>
          This Privacy Policy explains how Foundry Planning, Inc.
          (&ldquo;Foundry&rdquo;) handles personal information collected
          from advisors and Firms that use our application. For personal
          information about a Firm's clients that the Firm uploads to
          Foundry, the Firm is the controller and Foundry is the processor;
          the terms of our{" "}
          <Link href="/legal/dpa">Data Processing Addendum</Link> govern
          that data.
        </p>
      </section>

      <section>
        <h2>2. Information we collect</h2>
        <h3>From you, directly</h3>
        <ul>
          <li>
            Account identity: name, email, Firm name, role within the Firm.
          </li>
          <li>
            Authentication factors: passwords (hashed by Clerk), MFA
            factors, passkeys.
          </li>
          <li>
            Billing identity: legal Firm name, billing email, payment
            method (handled directly by Stripe; we do not see card numbers).
          </li>
          <li>
            Application content you choose to upload: client financial
            data, scenarios, documents for AI Import.
          </li>
          <li>
            Support correspondence.
          </li>
        </ul>
        <h3>Automatically</h3>
        <ul>
          <li>
            Application logs (request paths, error stack traces with PII
            redacted, performance metrics).
          </li>
          <li>
            Standard cookies for session management (set by Clerk) and
            CSRF protection.
          </li>
          <li>
            Limited device metadata (user-agent, approximate region from IP
            for fraud and rate-limit purposes).
          </li>
        </ul>
      </section>

      <section>
        <h2>3. How we use information</h2>
        <ul>
          <li>To operate, maintain, and improve the Service.</li>
          <li>To authenticate users and enforce role-based access.</li>
          <li>To bill and collect fees.</li>
          <li>
            To detect, prevent, and respond to fraud, abuse, and security
            incidents.
          </li>
          <li>
            To communicate with you about your account, security, billing,
            and product updates.
          </li>
          <li>To comply with legal obligations.</li>
        </ul>
        <p>
          We do not sell personal information. We do not use Firm or Firm
          client data to train AI models; the AI Import add-on uses Azure
          OpenAI under a no-training tenancy.
        </p>
      </section>

      <section>
        <h2>4. Legal bases (where applicable)</h2>
        <p>
          Where the GDPR or comparable laws apply, we process personal
          information under one of: (a) performance of contract, (b)
          legitimate interests in operating and securing the Service, (c)
          legal obligation, or (d) consent where specifically requested.
        </p>
      </section>

      <section>
        <h2>5. Sharing and subprocessors</h2>
        <p>
          We share information only with vendors processing on our behalf
          under written agreements that mirror our obligations. The current
          subprocessor list is at{" "}
          <a
            href="https://github.com/foundry-planning/foundry-planning/blob/main/docs/vendors.md"
            rel="noopener"
          >
            docs/vendors.md
          </a>{" "}
          (also linked from our DPA). We may disclose information when
          required by law, to protect our rights or others' safety, or in
          connection with a corporate transaction (with notice where
          permitted).
        </p>
      </section>

      <section>
        <h2>6. Retention</h2>
        <p>
          We retain Firm and client data for the life of the subscription.
          On cancellation, Firm data enters a 30-day read-only grace window
          for export. After 90 days post-cancellation, Firm data is purged
          from production stores; backups are rotated out within 35 days
          thereafter. Audit logs are retained for seven years for
          regulatory and SOC&nbsp;2 purposes.
        </p>
      </section>

      <section>
        <h2>7. Security</h2>
        <p>
          Foundry encrypts data in transit with TLS and at rest via Neon's
          managed Postgres. Access controls, audit logging, and incident
          response are described in our{" "}
          <Link href="/legal/dpa">Data Processing Addendum</Link>.
        </p>
      </section>

      <section>
        <h2>8. Your rights</h2>
        <p>
          Depending on your jurisdiction, you may have the right to access,
          correct, delete, or port the personal information we hold about
          you, and to object to or restrict certain processing. To exercise
          these rights, email{" "}
          <a href="mailto:support@foundryplanning.com">
            support@foundryplanning.com
          </a>
          . For requests about a Firm's client data, contact the Firm
          directly; we will support the Firm's response.
        </p>
      </section>

      <section>
        <h2>9. International transfers</h2>
        <p>
          Foundry stores application data in the United States. If you
          access the Service from outside the U.S., your information will
          be transferred to and processed in the U.S. We rely on the
          Standard Contractual Clauses or equivalent mechanisms where
          required.
        </p>
      </section>

      <section>
        <h2>10. Children</h2>
        <p>
          The Service is intended for businesses; we do not knowingly
          collect personal information from children under 16. If you
          believe a child has provided information, email us and we will
          delete it.
        </p>
      </section>

      <section>
        <h2>11. Changes</h2>
        <p>
          We will post any updates here with a new effective date and, for
          material changes, notify the Firm owner of record at least 30
          days in advance.
        </p>
      </section>

      <section>
        <h2>12. Contact</h2>
        <p>
          Foundry Planning, Inc. — questions about this policy:{" "}
          <a href="mailto:support@foundryplanning.com">
            support@foundryplanning.com
          </a>
          .
        </p>
      </section>
    </LegalPage>
  );
}
