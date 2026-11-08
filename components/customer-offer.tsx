"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  Clock3,
  ShieldCheck,
  Loader2,
  X,
} from "lucide-react";
import { money, time } from "@/lib/domain";
type Offer = {
  name: string;
  from: number;
  to: number;
  duration: number;
  refund: number;
  date: string;
  mode: string;
  consent: string;
  status: string;
  expiresAt: string;
  service: string;
  committed: boolean;
  refundStatus?: string;
};
export default function CustomerOffer({ token }: { token: string }) {
  const [offer, setOffer] = useState<Offer | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/offer/" + token)
      .then(async (r) => {
        const d = (await r.json()) as Offer & { error?: string };
        if (!r.ok) throw Error(d.error || "Request failed.");
        setOffer(d);
      })
      .catch((e) => setError(e.message));
  }, [token]);
  async function answer(answer: string) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/offer/" + token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer }),
      });
      const d = (await r.json()) as Offer & { error?: string };
      if (!r.ok) throw Error(d.error || "Request failed.");
      setOffer(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  const closed =
    !!offer && ["declined", "expired", "cancelled"].includes(offer.status);
  const available =
    offer?.status === "proposed" &&
    offer?.consent === "waiting" &&
    Date.parse(offer.expiresAt) > Date.now();
  return (
    <main className="offer-page">
      <Link href="/" className="brand">
        <span className="brand-mark">
          m<span>r</span>
        </span>
        make<span className="brand-light">room</span>
        <i />
      </Link>
      <article className="offer-card">
        {!offer ? (
          <>
            <span className="eyebrow">YOUR STUDIO APPOINTMENT</span>
            <h1>
              {error ? "This offer isn't available." : "Opening your offer..."}
            </h1>
            {error ? (
              <p role="alert">{error}</p>
            ) : (
              <Loader2 className="spin" size={24} />
            )}
          </>
        ) : (
          <>
            <span
              className={
                "pill " + (offer.mode === "practice" ? "practice" : "subtle")
              }
            >
              {offer.mode === "practice"
                ? "Practice offer · fictional customer"
                : "PayPal sandbox · test appointment"}
            </span>
            <span className="offer-decoration">
              <Clock3 size={32} />
            </span>
            <p className="eyebrow">A SMALL CHANGE, ON YOUR TERMS</p>
            <h1>
              Hi {offer.name.split(" ")[0]}.<br />
              {offer.committed
                ? "Your new time is confirmed."
                : closed
                  ? "Your original time stays."
                  : "Could you move your session?"}
            </h1>
            <p className="offer-intro">
              The studio can fit another session if your appointment moves.
              It&apos;s your choice.
            </p>
            <div className="offer-times">
              <div>
                <span>YOUR ORIGINAL TIME</span>
                <strong>{time(offer.from)}</strong>
              </div>
              <ArrowRight size={25} />
              <div>
                <span>PROPOSED START</span>
                <strong>{time(offer.to)}</strong>
              </div>
            </div>
            <p className="offer-session">
              Thursday, November 12 · {offer.duration} minutes
              <br />
              {offer.service} · Pacific time
            </p>
            <div className="offer-refund">
              <span>
                Your thank-you refund<strong>{money(offer.refund)}</strong>
              </span>
              <p>
                Back to your original payment method after the new booking is
                confirmed.
              </p>
            </div>
            {error && (
              <div className="error-banner" role="alert">
                {error}
              </div>
            )}
            {available ? (
              <div className="offer-actions">
                <button
                  className="button primary full"
                  disabled={busy}
                  onClick={() => answer("accepted")}
                >
                  {busy ? (
                    <Loader2 className="spin" size={17} />
                  ) : (
                    <Check size={17} />
                  )}
                  Yes, this works for me
                </button>
                <button
                  className="button secondary full"
                  disabled={busy}
                  onClick={() => answer("declined")}
                >
                  Keep my original time
                </button>
                <p className="fine-print">
                  Your original appointment stays in place until everyone
                  accepts and the new booking is paid.
                </p>
              </div>
            ) : (
              <div className="offer-result">
                <span
                  className={
                    "result-icon " +
                    (offer.consent === "declined" ? "declined" : "")
                  }
                >
                  {offer.consent === "declined" ? <X /> : <Check />}
                </span>
                <h2>
                  {offer.committed
                    ? "You're all set."
                    : closed
                      ? "This offer has closed."
                      : offer.consent === "accepted"
                        ? "Thanks, your answer is saved."
                        : offer.consent === "declined"
                          ? "Your original time stays."
                          : "This offer has closed."}
                </h2>
                <p>
                  {offer.committed
                    ? offer.refundStatus === "COMPLETED"
                      ? "Your agreed refund is complete."
                      : "Your agreed refund is being processed."
                    : !closed && offer.consent === "accepted"
                      ? "The studio is waiting for the remaining steps. Your appointment hasn't moved yet."
                      : "No change was made to your appointment."}
                </p>
              </div>
            )}
            <div className="offer-foot">
              <ShieldCheck size={16} />
              No change without your approval.
            </div>
          </>
        )}
      </article>
      <p className="offer-brand-foot">
        A little flexibility. More room for everyone.
      </p>
    </main>
  );
}
