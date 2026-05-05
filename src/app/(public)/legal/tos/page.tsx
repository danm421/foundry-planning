import Link from "next/link";
import LegalPage from "../LegalPage";

export const metadata = {
  title: "Terms of Service — Foundry Planning",
  robots: { index: true, follow: true },
};

export default function TosPage() {
  return (
    <LegalPage
      eyebrow="03 · Terms of service"
      title="Terms of Service"
      lastUpdated="May 1, 2026"
    >
      <section>
        <h2>1. Agreement</h2>
        <p>
          These Terms of Service (the &ldquo;Terms&rdquo;) form a binding
          agreement between Foundry Planning, Inc. (&ldquo;Foundry,&rdquo;
          &ldquo;we&rdquo;) and the entity identified during sign-up
          (&ldquo;Firm,&rdquo; &ldquo;you&rdquo;). By creating an account,
          accepting these Terms during checkout, or using the service, you
          agree to these Terms on behalf of your Firm and represent that you
          have authority to do so.
        </p>
      </section>

      <section>
        <h2>2. The service</h2>
        <p>
          Foundry Planning is a cash-flow planning application for financial
          advisors. The service includes the projection engine, tax
          modelling, estate planning tools, Monte Carlo simulator, branded
          report rendering, and any optional add-ons your Firm enables (the
          &ldquo;Service&rdquo;).
        </p>
      </section>

      <section>
        <h2>3. Accounts and Firm membership</h2>
        <p>
          Each subscription is scoped to a single Firm. The Firm owner
          controls membership, role assignment, and billing. Members may
          access and edit any client data within the Firm subject to
          internal Firm policy. You are responsible for maintaining the
          confidentiality of credentials and for all activity under your
          Firm&rsquo;s account.
        </p>
      </section>

      <section>
        <h2>4. Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>
            Reverse-engineer or attempt to extract the source code of the
            Service.
          </li>
          <li>
            Use the Service to provide a competing planning or projection
            product without our written consent.
          </li>
          <li>
            Upload content that violates law or infringes third-party
            rights, or use the Service to harass any person.
          </li>
          <li>
            Probe, scan, or test the vulnerability of the Service except
            through a written authorization (responsible-disclosure program
            forthcoming).
          </li>
          <li>
            Resell, sublicense, or share access with anyone outside your
            Firm.
          </li>
        </ul>
      </section>

      <section>
        <h2>5. Fees, trial, and cancellation</h2>
        <p>
          Subscriptions are billed per advisor per month or per year, plus
          any optional add-ons your Firm enables. Public pricing is at{" "}
          <Link href="/pricing">/pricing</Link>. New subscriptions begin
          with a 14-day trial during which the payment method is collected
          but not charged. After the trial, the subscription auto-renews on
          the cycle you selected unless cancelled.
        </p>
        <p>
          You may cancel at any time through the Customer Portal accessible
          from your settings. Cancellation takes effect at the end of the
          current billing period; we do not pro-rate partial periods. We may
          change pricing on at least 30 days&rsquo; written notice (email to the
          Firm owner of record); changes apply to your next renewal.
        </p>
      </section>

      <section>
        <h2>6. Client data and Firm responsibilities</h2>
        <p>
          The Firm is the controller of any personal information about its
          clients that the Firm uploads or enters into the Service. Foundry
          processes that information solely to provide the Service per these
          Terms and our{" "}
          <Link href="/legal/dpa">Data Processing Addendum</Link>. The Firm
          represents that it has the legal basis to provide such
          information to Foundry, including any consent required under
          applicable privacy law.
        </p>
      </section>

      <section>
        <h2>7. Confidentiality and security</h2>
        <p>
          Each party will protect the other&rsquo;s confidential information with
          at least the same care it uses for its own confidential
          information of similar sensitivity. Foundry&rsquo;s security measures
          are described in our{" "}
          <Link href="/legal/dpa">Data Processing Addendum</Link>.
        </p>
      </section>

      <section>
        <h2>8. Warranty disclaimer</h2>
        <p>
          The Service is provided &ldquo;as is.&rdquo; To the maximum extent
          permitted by law, Foundry disclaims all warranties, express or
          implied, including merchantability, fitness for a particular
          purpose, and non-infringement. Foundry does not provide tax,
          legal, or investment advice; outputs of the Service are
          informational and rely on inputs supplied by the Firm.
        </p>
      </section>

      <section>
        <h2>9. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, neither party will be
          liable for indirect, incidental, consequential, or punitive
          damages, or for lost profits or revenue. Each party&rsquo;s total
          liability arising under these Terms is limited to fees paid by
          the Firm to Foundry in the twelve months immediately preceding
          the claim. These limits do not apply to: (a) breaches of
          confidentiality; (b) indemnification obligations; or (c)
          a party&rsquo;s gross negligence or willful misconduct.
        </p>
      </section>

      <section>
        <h2>10. Term and termination</h2>
        <p>
          These Terms remain in effect while the Firm has an active
          subscription. Either party may terminate for material breach not
          cured within 30 days of written notice. On termination, Firm
          access is revoked at the end of any read-only grace period
          described in our retention policy (see{" "}
          <Link href="/legal/privacy">Privacy Policy</Link>).
        </p>
      </section>

      <section>
        <h2>11. Changes</h2>
        <p>
          We may update these Terms by posting a revised version with a new
          effective date. Material changes take effect 30 days after notice
          to the Firm owner of record. Continued use after the effective
          date constitutes acceptance.
        </p>
      </section>

      <section>
        <h2>12. Miscellaneous</h2>
        <p>
          These Terms are governed by the laws of the United States and the
          State of [governing-law placeholder — to be set by counsel],
          without regard to conflict-of-laws rules. Disputes are resolved
          in the state or federal courts sitting in that jurisdiction. If
          any term is unenforceable, the rest remains in effect. These
          Terms are the entire agreement between the parties on this
          subject and supersede prior agreements.
        </p>
        <p>
          Questions? Email{" "}
          <a href="mailto:support@foundryplanning.com">
            support@foundryplanning.com
          </a>
          .
        </p>
      </section>
    </LegalPage>
  );
}
