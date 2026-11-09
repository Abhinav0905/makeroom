import Link from "@/components/app-link";
import { appHref } from "@/lib/client-runtime";
import { ArrowLeft, CheckCircle2, ExternalLink } from "lucide-react";

export default function ProofPage() {
  return (
    <main className="proof-page">
      <Link href="/" className="button secondary">
        <ArrowLeft size={16} /> Try the studio
      </Link>
      <p className="eyebrow">VERIFIED PAYPAL SANDBOX RUN</p>
      <h1>
        A booking made.
        <br />
        Two promises paid.
      </h1>
      <p className="proof-lead">
        The application completed a PayPal sandbox checkout, then read the
        captures and refunds back through the PayPal API. This is the recorded
        result of that run, checked November 8, 2026 at 20:44 UTC.
      </p>
      <div className="proof-summary">
        <article>
          <span>New booking captured</span>
          <strong>$145</strong>
          <small>Maya · 2–4 pm</small>
        </article>
        <article>
          <span>Original payments refunded</span>
          <strong>$25</strong>
          <small>$15 to Alex + $10 to Sam</small>
        </article>
        <article>
          <span>Added gross revenue</span>
          <strong>$120</strong>
          <small>Before fees and taxes</small>
        </article>
      </div>
      <section className="proof-record">
        <h2>Independent API readback</h2>
        <p>USD. Sandbox only. No live money moved.</p>
        <table>
          <thead>
            <tr>
              <th>Payment</th>
              <th>Amount</th>
              <th>PayPal status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Alex&apos;s original capture</td>
              <td>$60.00</td>
              <td>PARTIALLY_REFUNDED</td>
            </tr>
            <tr>
              <td>Sam&apos;s original capture</td>
              <td>$60.00</td>
              <td>PARTIALLY_REFUNDED</td>
            </tr>
            <tr>
              <td>Maya&apos;s new capture</td>
              <td>$145.00</td>
              <td>
                <CheckCircle2 size={15} /> COMPLETED
              </td>
            </tr>
            <tr>
              <td>Alex&apos;s partial refund</td>
              <td>$15.00</td>
              <td>
                <CheckCircle2 size={15} /> COMPLETED
              </td>
            </tr>
            <tr>
              <td>Sam&apos;s partial refund</td>
              <td>$10.00</td>
              <td>
                <CheckCircle2 size={15} /> COMPLETED
              </td>
            </tr>
          </tbody>
        </table>
        <a
          href={appHref("/evidence/sandbox-verification.json")}
          target="_blank"
          rel="noreferrer"
        >
          Read the captured API results <ExternalLink size={14} />
        </a>
      </section>
      <section className="proof-record">
        <h2>Try it yourself.</h2>
        <p>
          The public practice studio runs the real AI reader, planner and
          separate customer consent pages. Its payments are explicitly
          simulated. Each browser gets its own practice record.
        </p>
        <p>
          For a fresh PayPal sandbox run, follow
          the repository instructions with your own sandbox merchant and buyer
          accounts. The recorded run used one sandbox buyer to represent three
          fictional customers.
        </p>
        <p>
          This verifies one sandbox sequence. It is not evidence of live payment
          reliability, real customer adoption or product demand.
        </p>
        <a
          href="https://github.com/Abhinav0905/makeroom"
          target="_blank"
          rel="noreferrer"
        >
          Source, MIT license and setup <ExternalLink size={14} />
        </a>
      </section>
    </main>
  );
}
