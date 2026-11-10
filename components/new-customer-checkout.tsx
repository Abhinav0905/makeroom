"use client";
import Link from "./app-link";
import { apiFetch } from "@/lib/client-runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarCheck,
  Check,
  CheckCheck,
  Clock3,
  CreditCard,
  Loader2,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { money, time } from "@/lib/domain";
import { pacificTime, type CheckoutView } from "@/lib/customer-views";
type Reply = CheckoutView & { error?: string; approvalUrl?: string };
class LinkError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
const longDate = (date: string) =>
  new Date(date + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const message = (e: unknown) =>
  e instanceof Error ? e.message : "Please try again.";
const FINAL = ["complete", "declined", "expired", "cancelled"];
type State =
  | "booked"
  | "lapsed"
  | "approved"
  | "checking"
  | "closed"
  | "studio"
  | "waiting"
  | "ready";
const HEADLINES: Record<State, string> = {
  booked: "You're booked.",
  lapsed: "Your time hold has expired.",
  approved: "Your payment is approved.",
  checking: "Your payment is being checked.",
  closed: "This booking has closed.",
  studio: "The studio is finishing your payment.",
  waiting: "Your session is almost ready.",
  ready: "Your session is ready to book.",
};
export default function NewCustomerCheckout({ token }: { token: string }) {
  const [view, setView] = useState<CheckoutView | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [leaving, setLeaving] = useState(false),
    // When the view was last read, so expiry is judged against a known time.
    [readAt, setReadAt] = useState(0);
  const started = useRef(false);
  const call = useCallback(
    async (init?: RequestInit): Promise<Reply> => {
      let r: Response;
      try {
        r = await apiFetch("/api/checkout/" + encodeURIComponent(token), {
          cache: "no-store",
          ...init,
        });
      } catch {
        throw new LinkError(
          "We couldn't reach the studio. Check your connection and try again.",
          0,
        );
      }
      const d = (await r.json().catch(() => null)) as Reply | null;
      if (!r.ok || !d)
        throw new LinkError(
          d?.error || "This booking link isn't available.",
          r.status,
        );
      return d;
    },
    [token],
  );
  const post = useCallback(
    (body: Record<string, string>) =>
      call({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    [call],
  );
  const show = useCallback((d: CheckoutView) => {
    setView(d);
    setReadAt(Date.now());
  }, []);
  const load = useCallback(async () => {
    const d = await call();
    show(d);
    return d;
  }, [call, show]);
  const send = useCallback(
    async (body: Record<string, string>) => {
      setBusy(true);
      setError("");
      setNotice("");
      try {
        const d = await post(body);
        show(d);
        return d;
      } catch (e) {
        // Show where things really stand, e.g. already booked.
        await load().catch(() => {});
        setError(message(e));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [post, show, load],
  );
  // First load. A PayPal return carries ?paypal=approved|cancel and the
  // order as token; it is consumed once and removed from the address bar.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const q = new URLSearchParams(location.search);
    const result = q.get("paypal"),
      orderId = q.get("token");
    if (result) {
      for (const key of ["paypal", "token", "PayerID"]) q.delete(key);
      const rest = q.toString();
      history.replaceState(null, "", location.pathname + (rest ? "?" + rest : ""));
    }
    const first =
      result === "approved" && orderId
        ? post({ action: "approved", orderId })
        : call();
    first
      .then((d) => {
        show(d);
        if (result === "cancel")
          setNotice(
            "You left PayPal before approving. Nothing was charged. You can try again.",
          );
      })
      .catch(async (e) => {
        await load().catch(() => {});
        setError(message(e));
      });
  }, [call, post, show, load]);
  // Keep the page current while customers answer and the studio confirms.
  const live = !!view && !view.booked && !FINAL.includes(view.status);
  useEffect(() => {
    if (!live || busy || leaving) return;
    const t = setInterval(() => {
      load().catch((e) => {
        if (e instanceof LinkError && [404, 410].includes(e.status)) {
          setView(null);
          setError(e.message);
        }
      });
    }, 8000);
    return () => clearInterval(t);
  }, [live, busy, leaving, load]);
  async function pay() {
    const d = await send({ action: "pay" });
    if (d?.approvalUrl) {
      setLeaving(true);
      location.assign(d.approvalUrl);
    }
  }
  const v = view;
  const first = v?.name.split(" ")[0] ?? "";
  const practice = v?.mode === "practice";
  const timeLeft = v ? Date.parse(v.expiresAt) - readAt : 0;
  const state: State = !v
    ? "closed"
    : v.booked
      ? "booked"
      : v.status === "authorized"
        ? v.payment === "lapsed" || timeLeft <= 0
          ? "lapsed"
          : "approved"
        : ["declined", "expired", "cancelled"].includes(v.status) ||
            (v.status === "proposed" && timeLeft <= 0)
          ? "closed"
          : v.status === "proposed"
            ? v.payment === "studio"
              ? "studio"
              : v.accepted < v.affected
                ? "waiting"
                : "ready"
            : "checking";
  const waiting = v ? v.affected - v.accepted : 0;
  const closedReason = !v
    ? ""
    : v.status === "declined"
      ? "A customer chose to keep their original time, so this time isn't available."
      : v.status === "cancelled"
        ? "The studio closed this booking request."
        : "Your time was held for 30 minutes and that has passed. Ask the studio for a new link.";
  return (
    <main className="offer-page">
      <Link href="/" className="brand">
        <span className="brand-mark">
          m<span>r</span>
        </span>
        make<span className="brand-light">room</span>
        <i />
      </Link>
      <article className="offer-card checkout-card">
        {!v ? (
          <>
            <span className="eyebrow">YOUR NEW BOOKING</span>
            <h1>
              {error
                ? "This booking link isn't available."
                : "Opening your booking..."}
            </h1>
            {error ? (
              <p className="offer-intro" role="alert">
                {error}
              </p>
            ) : (
              <Loader2 className="spin checkout-loading" size={24} />
            )}
          </>
        ) : (
          <>
            <span className={"pill " + (practice ? "practice" : "subtle")}>
              {practice
                ? "Practice checkout · fictional customer"
                : "PayPal sandbox · test payment"}
            </span>
            <span className="offer-decoration">
              <CalendarCheck size={30} />
            </span>
            <p className="eyebrow">YOUR NEW BOOKING</p>
            <h1>
              Hi {first}.
              <span>{HEADLINES[state]}</span>
            </h1>
            <p className="offer-intro">
              {state === "booked"
                ? "Your session is confirmed. Thank you for booking."
                : state === "lapsed"
                  ? "PayPal approved your payment, but the studio didn't confirm it in time."
                  : state === "approved"
                    ? "Thank you. PayPal is holding your payment while the studio confirms."
                    : state === "checking"
                      ? "The studio is checking your payment with PayPal."
                      : state === "closed"
                        ? "This time couldn't be held for you."
                        : state === "studio"
                          ? "The studio started the PayPal payment for this booking."
                          : v.affected === 0
                        ? "This time is free and held for you."
                        : state === "waiting"
                          ? `The studio asked ${plural(v.affected, "customer")} to move so you can have this time. You can pay once they agree.`
                          : `${plural(v.affected, "customer")} agreed to move so you can have this time.`}
            </p>
            <div className="offer-times checkout-time">
              <div>
                <span>YOUR SESSION</span>
                <strong>
                  {time(v.start)} – {time(v.start + v.duration)}
                </strong>
              </div>
            </div>
            <p className="offer-session">
              {longDate(v.date)} · {v.duration} minutes
              <br />
              {v.service} · Pacific time
            </p>
            <div className="checkout-breakdown">
              <div className="checkout-line">
                <span>Studio session</span>
                <strong>{money(v.price)}</strong>
              </div>
              {v.affected > 0 && (
                <div className="checkout-line">
                  <span>
                    Customer flexibility
                    <small>
                      Refunded to the customers who moved so you could have
                      this time.
                    </small>
                  </span>
                  <strong>{money(v.flexibility)}</strong>
                </div>
              )}
              <div className="checkout-line total">
                <span>{state === "booked" ? "Total paid" : "Total"}</span>
                <strong>{money(v.total)}</strong>
              </div>
            </div>
            {v.affected > 0 && (
              <div
                className={
                  "checkout-agreed " +
                  (waiting === 0 ? "done" : v.status === "declined" ? "declined" : "")
                }
              >
                <span className="checkout-agreed-icon">
                  {waiting === 0 ? (
                    <CheckCheck size={16} />
                  ) : v.status === "declined" ? (
                    <X size={16} />
                  ) : (
                    <Users size={16} />
                  )}
                </span>
                <div>
                  <strong>
                    {v.accepted} of {plural(v.affected, "customer")} agreed
                  </strong>
                  <small>
                    {waiting === 0
                      ? "Every move is approved."
                      : v.status === "declined"
                        ? "A customer kept their original time."
                        : "Each customer approves their own move."}
                  </small>
                </div>
                <span className="checkout-dots" aria-hidden="true">
                  {Array.from({ length: v.affected }, (_, i) => (
                    <i key={i} className={i < v.accepted ? "on" : ""} />
                  ))}
                </span>
              </div>
            )}
            {notice && (
              <div className="notice-banner" role="status">
                {notice}
              </div>
            )}
            {error && (
              <div className="error-banner" role="alert">
                {error}
              </div>
            )}
            {state === "ready" || state === "waiting" ? (
              <div className="offer-actions">
                <button
                  className="button primary full checkout-pay"
                  disabled={state === "waiting" || busy || leaving}
                  onClick={pay}
                >
                  {busy || leaving ? (
                    <Loader2 className="spin" size={17} />
                  ) : (
                    <CreditCard size={17} />
                  )}
                  {leaving
                    ? "Opening PayPal..."
                    : practice
                      ? `Pay ${money(v.total)} (practice, no money moves)`
                      : "Pay with PayPal"}
                </button>
                <p className="fine-print">
                  {state === "waiting"
                    ? `Waiting for ${plural(waiting, "more customer")} to agree. This page updates on its own.`
                    : practice
                      ? "The charge and the refunds are simulated."
                      : v.payment === "started"
                        ? "You started paying earlier. Pay with PayPal picks up where you left off."
                        : `You approve a ${money(v.total)} hold in PayPal sandbox. The studio confirms your booking, then charges it.`}
                  <br />
                  Your time is held until {pacificTime(v.expiresAt)} Pacific
                  time.
                </p>
              </div>
            ) : (
              <div className="offer-result">
                <span
                  className={
                    "result-icon " +
                    (state === "closed" || state === "lapsed" ? "declined" : "")
                  }
                >
                  {state === "closed" || state === "lapsed" ? (
                    <X />
                  ) : state === "booked" ? (
                    <CheckCheck />
                  ) : state === "studio" ? (
                    <Clock3 />
                  ) : (
                    <Check />
                  )}
                </span>
                <h2>
                  {state === "booked"
                    ? `See you ${longDate(v.date)}.`
                    : state === "approved"
                      ? "The studio confirms next."
                      : state === "checking"
                        ? "No need to pay again."
                        : state === "studio"
                          ? "Nothing to pay here."
                          : "Nothing was charged."}
                </h2>
                <p>
                  {state === "booked"
                    ? practice
                      ? `Practice payment of ${money(v.total)} complete. No money moved.`
                      : `Paid ${money(v.total)} with PayPal sandbox. The agreed refunds go to the customers who moved.`
                    : state === "approved"
                      ? `${money(v.total)} is on hold, not charged. Once the studio confirms your booking, PayPal charges it and the agreed refunds go to the customers who moved.`
                      : state === "checking"
                        ? "Nothing more is needed from you right now. The studio will confirm what PayPal shows."
                        : state === "studio"
                          ? "The studio will finish the payment with you. This page updates on its own."
                          : state === "lapsed"
                            ? "The studio will release the hold on your payment. Ask the studio for a new link to book this time again."
                            : closedReason}
                </p>
              </div>
            )}
            <div className="offer-foot">
              <ShieldCheck size={16} />
              Nothing is charged until every customer agrees.
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
