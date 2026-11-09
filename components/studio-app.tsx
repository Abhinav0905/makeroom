"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  Clock3,
  CreditCard,
  Download,
  ExternalLink,
  HelpCircle,
  History,
  LayoutGrid,
  Link2,
  Loader2,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  X,
  AlertCircle,
} from "lucide-react";
import { seed, money, time, type Studio } from "@/lib/domain";
import StudioCalendar from "./studio-calendar";
import PreferenceEditor from "./preference-editor";
type Integrations = {
  guest?: boolean;
  paypal: boolean;
  ai: boolean;
  aiProvider: string | null;
  aiModel: string;
  webhooks: boolean;
};
type View = "studio" | "customers" | "activity" | "settings";
const defaults: Integrations = {
  paypal: false,
  ai: false,
  aiProvider: null,
  aiModel: "",
  webhooks: false,
};
export default function StudioApp() {
  const [studio, setStudio] = useState<Studio>(seed),
    [integrations, setIntegrations] = useState<Integrations>(defaults);
  const [ready, setReady] = useState(false),
    [login, setLogin] = useState(false),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [view, setView] = useState<View>("studio"),
    [request, setRequest] = useState(studio.request),
    [help, setHelp] = useState(false);
  const processed = useRef(false);
  const helpRef = useRef<HTMLDialogElement>(null);
  const refresh = useCallback(async () => {
    const res = await fetch("/api/studio", { cache: "no-store" });
    const d = (await res.json()) as {
      studio: Studio;
      integrations: Integrations;
      error?: string;
    };
    if (res.status === 401) {
      setLogin(true);
      return null;
    }
    if (!res.ok) throw Error(d.error || "Request failed.");
    setStudio(d.studio);
    setRequest(d.studio.request);
    setIntegrations(d.integrations);
    setReady(true);
    setLogin(false);
    return d.studio as Studio;
  }, []);
  // State is updated after the workspace fetch resolves, never synchronously here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh().catch((e) => setError(e.message));
  }, [refresh]);

  useEffect(() => {
    if (!ready || !studio.plan || studio.plan.status === "complete") return;
    const t = setInterval(() => {
      if (!busy) refresh().catch(() => {});
    }, 8000);
    return () => clearInterval(t);
  }, [ready, studio.plan, busy, refresh]);
  useEffect(() => {
    if (help) helpRef.current?.showModal();
    else helpRef.current?.close();
  }, [help]);
  async function act(
    action: string,
    data: Record<string, unknown> = {},
  ): Promise<Studio | null> {
    if (busy) return null;
    setBusy(action);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, version: studio.version, ...data }),
      });
      const d = (await res.json()) as {
        studio: Studio;
        integrations: Integrations;
        error?: string;
      };
      if (!res.ok) {
        await refresh();
        if (action === "plan") setRequest(request);
        throw Error(d.error || "Request failed.");
      }
      setStudio(d.studio);
      setRequest(d.studio.request);
      setIntegrations(d.integrations);
      return d.studio;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
      return null;
    } finally {
      setBusy("");
    }
  }
  useEffect(() => {
    if (!ready || processed.current) return;
    const q = new URLSearchParams(location.search);
    const result = q.get("paypal"),
      orderId = q.get("token");
    if (!result) return;
    processed.current = true;
    history.replaceState(null, "", location.pathname);
    // URL return state is an external checkout event, consumed once.
    if (result === "cancel") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNotice(
        "Checkout was closed. Check payment status or cancel the offer to release any authorization.",
      );
      return;
    }
    if (orderId)
      void act(result === "booking" ? "finish-funding" : "finish-approval", {
        orderId,
        ...(result === "booking" ? { bookingId: q.get("booking") } : {}),
      });
    // Process a PayPal return exactly once after the authenticated workspace loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  const p = studio.plan;
  const viable = p && !["declined", "expired", "cancelled"].includes(p.status);
  const locked = !!studio.operation || !!p?.orderId || !!p?.committed;
  const accepted = p?.moves.filter((m) => m.consent === "accepted").length ?? 0;
  const allAccepted = !!p && p.moves.every((m) => m.consent === "accepted");
  const disabled = !!busy || !ready;
  async function checkout() {
    const s = await act(
      studio.mode === "practice" ? "practice-settle" : "checkout",
    );
    if (s?.plan?.approvalUrl) location.assign(s.plan.approvalUrl);
  }
  async function fund(bookingId: string) {
    const s = await act("fund-booking", { bookingId });
    const url = s?.bookings.find((b) => b.id === bookingId)?.fundingApprovalUrl;
    if (url) location.assign(url);
  }
  async function copyOffer(token: string) {
    try {
      await navigator.clipboard.writeText(location.origin + "/offer/" + token);
      setNotice(
        "Customer offer link copied. Send it only to the intended customer.",
      );
    } catch {
      setError(
        "Clipboard access is unavailable. Open the offer and copy its address.",
      );
    }
  }
  function exportRecord() {
    const copy = structuredClone(studio);
    copy.plan?.moves.forEach((m) => {
      m.token = "[private offer link omitted]";
    });
    const blob = new Blob(
      [
        JSON.stringify(
          { exportedAt: new Date().toISOString(), ...copy },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "makeroom-studio-record.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  const nav = [
    { id: "studio" as const, label: "Studio day", icon: LayoutGrid },
    { id: "customers" as const, label: "Customers", icon: Users },
    { id: "activity" as const, label: "Activity", icon: History },
    { id: "settings" as const, label: "Connections", icon: Settings2 },
  ];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark">
            m<span>r</span>
          </span>
          make<span className="brand-light">room</span>
          <i />
        </Link>
        <button className="studio-switch" onClick={() => setView("settings")}>
          <span className="studio-icon">
            <CalendarDays size={18} />
          </span>
          <span>
            <strong>Olive & Light</strong>
            <small>Photography studio</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <span className="nav-label">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {nav.map((n) => (
            <button
              className={"nav-item " + (view === n.id ? "active" : "")}
              key={n.id}
              onClick={() => setView(n.id)}
              aria-current={view === n.id ? "page" : undefined}
            >
              <n.icon size={18} />
              {n.label}
              {n.id === "studio" && <span className="nav-count">1</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="small-spark">
              <Sparkles size={17} />
            </span>
            <strong>
              Good things fit
              <br />
              with a little flexibility.
            </strong>
            <p>
              More room for your work.
              <br />A fair deal for everyone.
            </p>
          </div>
          <button className="nav-item" onClick={() => setHelp(true)}>
            <HelpCircle size={18} />
            How it works
            <ArrowUpRight size={15} />
          </button>
          <a className="nav-item" href="/proof">
            Sandbox evidence <ArrowUpRight size={15} />
          </a>
          <div className="studio-profile">
            <span className="avatar forest">OL</span>
            <div>
              <strong>Your studio</strong>
              <small>Single-resource workspace</small>
            </div>
            <span className="online-dot" />
          </div>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <div className="breadcrumbs">
            Workspace<span>/</span>
            <strong>{nav.find((n) => n.id === view)?.label}</strong>
          </div>
          <div className="topbar-right">
            <span
              className={
                "mode-badge " + (studio.mode === "practice" ? "" : "sandbox")
              }
            >
              <span className="dot" />
              {studio.mode === "practice"
                ? "Practice studio"
                : "PayPal sandbox"}
            </span>
            <button
              className="icon-button"
              title="Refresh studio"
              aria-label="Refresh studio"
              onClick={() => refresh().catch((e) => setError(e.message))}
              disabled={disabled}
            >
              <RotateCcw size={16} />
            </button>
            <button
              className="icon-button"
              aria-label="How MakeRoom works"
              onClick={() => setHelp(true)}
            >
              <HelpCircle size={18} />
            </button>
          </div>
        </header>
        <main className="main-content">
          {integrations.guest && (
            <div className="notice-banner" role="status">
              Your own practice studio. Try AI, approve both customer offers,
              then complete the simulated booking. No sign-in needed.
            </div>
          )}
          {login && (
            <div className="login-banner">
              <div>
                <strong>Your studio is ready to open.</strong>
                <p>Sign in to save plans and customer responses.</p>
              </div>
              <a
                className="button primary"
                href="/signin-with-chatgpt?return_to=%2F"
                target="_top"
              >
                Open my studio <ArrowRight size={16} />
              </a>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
              <button
                className="icon-button"
                onClick={() => setError("")}
                aria-label="Dismiss error"
              >
                <X size={15} />
              </button>
            </div>
          )}
          {notice && (
            <div className="notice-banner" role="status">
              <Check size={17} />
              <span>{notice}</span>
              <button
                className="icon-button"
                onClick={() => setNotice("")}
                aria-label="Dismiss notice"
              >
                <X size={15} />
              </button>
            </div>
          )}
          {view === "studio" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">
                    <span className="tiny-line" /> A LITTLE FLEXIBILITY GOES A
                    LONG WAY
                  </span>
                  <h1>
                    Make space for
                    <br />
                    <em>one more booking.</em>
                  </h1>
                  <p>
                    Turn scattered free time into a session that fits everyone.
                  </p>
                </div>
                <div className="date-display">
                  <span>THURSDAY</span>
                  <strong>
                    12<span>NOV</span>
                  </strong>
                  <small>2026 · Pacific time</small>
                </div>
              </div>
              <div className="insight-strip">
                <div>
                  <span className="insight-icon">
                    <Clock3 size={18} />
                  </span>
                  <p>
                    <strong>
                      {(240 -
                        studio.bookings.reduce((n, b) => n + b.duration, 0) -
                        (p?.committed ? p.request.duration : 0)) /
                        60}{" "}
                      hours
                    </strong>
                    <span>
                      {p?.committed ? "left unbooked" : "free, but split apart"}
                    </span>
                  </p>
                </div>
                <div>
                  <span className="insight-icon">
                    <Users size={18} />
                  </span>
                  <p>
                    <strong>
                      {
                        studio.bookings.filter((b) => b.alternatives.length)
                          .length
                      }{" "}
                      flexible customers
                    </strong>
                    <span>every move needs their approval</span>
                  </p>
                </div>
                <div>
                  <span className="insight-icon">
                    <ArrowUpRight size={18} />
                  </span>
                  <p>
                    <strong>
                      {money(p?.request.base ?? request.base)}{" "}
                      {p?.committed ? "added" : "opportunity"}
                    </strong>
                    <span>booking revenue before fees & tax</span>
                  </p>
                </div>
              </div>
              <div className="workspace-grid">
                <div className="calendar-side">
                  <StudioCalendar studio={studio} />
                  <div className="flexibility-section">
                    <div className="flexibility-heading">
                      <h2>A little give, a little get.</h2>
                      <span>Customer flexibility</span>
                    </div>
                    <div className="preference-grid">
                      {studio.bookings.map((b) => (
                        <PreferenceEditor
                          key={b.id}
                          booking={b}
                          busy={disabled}
                          ai={integrations.ai}
                          locked={locked}
                          act={act}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                <aside className="request-column">
                  <section className="request-card">
                    <div className="request-top">
                      <span className="eyebrow">ONE MORE POSSIBILITY</span>
                      <span className="request-number">01</span>
                    </div>
                    <h2>
                      {p?.committed
                        ? "A perfect fit."
                        : "A booking worth making room for."}
                    </h2>
                    <div className="request-person">
                      <span className="avatar lilac">MC</span>
                      <div>
                        <strong>{p?.request.name ?? request.name}</strong>
                        <span>{p?.request.service ?? request.service}</span>
                      </div>
                    </div>
                    {!viable ? (
                      <div className="request-form">
                        <div className="form-two">
                          <label>
                            Start time
                            <select
                              aria-label="Requested start time"
                              value={request.start}
                              onChange={(e) =>
                                setRequest({
                                  ...request,
                                  start: +e.target.value,
                                })
                              }
                              disabled={disabled || locked}
                            >
                              {[780, 810, 840, 870, 900, 930, 960].map((t) => (
                                <option key={t} value={t}>
                                  {time(t)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Session length
                            <select
                              aria-label="Session length"
                              value={request.duration}
                              onChange={(e) =>
                                setRequest({
                                  ...request,
                                  duration: +e.target.value,
                                  base: +e.target.value * 100,
                                })
                              }
                              disabled={disabled || locked}
                            >
                              {[60, 90, 120].map((d) => (
                                <option key={d} value={d}>
                                  {d} minutes
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className="budget-label">
                          <label htmlFor="budget">Flexibility budget</label>
                          <strong>{money(request.budget)}</strong>
                        </div>
                        <input
                          aria-label="Flexibility budget"
                          id="budget"
                          className="budget-slider"
                          type="range"
                          min={0}
                          max={6000}
                          step={500}
                          value={request.budget}
                          onChange={(e) =>
                            setRequest({ ...request, budget: +e.target.value })
                          }
                          disabled={disabled || locked}
                        />
                        <div className="range-labels">
                          <span>$0</span>
                          <span>$60</span>
                        </div>
                        <p className="fine-print">
                          The most Maya will add to thank customers who move.
                        </p>
                        <div className="price-row">
                          <span>Session price</span>
                          <strong>{money(request.base)}</strong>
                        </div>
                        <button
                          className="button primary full find-button"
                          disabled={disabled || locked}
                          onClick={() => act("plan", { request })}
                        >
                          {busy === "plan" ? (
                            <Loader2 className="spin" size={17} />
                          ) : (
                            <Sparkles size={17} />
                          )}
                          Find an arrangement
                          <ArrowRight size={17} />
                        </button>
                        {p &&
                          ["declined", "expired", "cancelled"].includes(
                            p.status,
                          ) && (
                            <div className="closed-offer">
                              <strong>
                                {p.status === "declined"
                                  ? "A customer kept their original time."
                                  : p.status === "expired"
                                    ? "This offer expired."
                                    : "The offer was cancelled."}
                              </strong>
                              <span>
                                Review the terms before making another offer.
                              </span>
                            </div>
                          )}
                      </div>
                    ) : (
                      <div className="plan-details">
                        <div className="plan-found">
                          <span className="result-icon">
                            <CheckCheck size={19} />
                          </span>
                          <div>
                            <strong>
                              {p.committed
                                ? "The new session is booked."
                                : "There's a way to make it work."}
                            </strong>
                            <span>
                              {p.moves.length} move
                              {p.moves.length === 1 ? "" : "s"} ·{" "}
                              {money(p.totalRefund)} in thank-you refunds
                            </span>
                          </div>
                        </div>
                        <div className="steps">
                          <span className="done">
                            1 <small>Arrange</small>
                          </span>
                          <i />
                          <span className={allAccepted ? "done" : ""}>
                            2 <small>Agree</small>
                          </span>
                          <i />
                          <span className={p.committed ? "done" : ""}>
                            3 <small>Book</small>
                          </span>
                        </div>
                        <div className="consent-heading">
                          <span>CUSTOMER APPROVALS</span>
                          <strong>
                            {accepted}/{p.moves.length}
                          </strong>
                        </div>
                        {p.moves.map((m) => (
                          <div className="move-card" key={m.bookingId}>
                            <div className="move-name">
                              <strong>{m.name.split(" ")[0]}</strong>
                              <span className={"consent-pill " + m.consent}>
                                {m.consent === "accepted" ? (
                                  <Check size={11} />
                                ) : (
                                  <Clock3 size={11} />
                                )}{" "}
                                {m.consent}
                              </span>
                            </div>
                            <div className="move-times">
                              {time(m.from)}
                              <ArrowRight size={13} />
                              {time(m.to)}
                              <b>{money(m.refund)} back</b>
                            </div>
                            {!p.committed && m.consent === "waiting" && (
                              <div className="move-actions">
                                <a
                                  href={"/offer/" + m.token}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Open customer offer <ExternalLink size={12} />
                                </a>
                                <button
                                  className="icon-button"
                                  aria-label={"Copy offer link for " + m.name}
                                  onClick={() => copyOffer(m.token)}
                                >
                                  <Link2 size={14} />
                                </button>
                              </div>
                            )}
                            {p.committed && (
                              <small className="refund-status">
                                Refund: {m.refundStatus?.toLowerCase() ?? "due"}
                              </small>
                            )}
                          </div>
                        ))}
                        <div className="payment-summary">
                          <div>
                            <span>Studio session</span>
                            <span>{money(p.request.base)}</span>
                          </div>
                          <div>
                            <span>Customer flexibility</span>
                            <span>{money(p.totalRefund)}</span>
                          </div>
                          <div className="payment-total">
                            <strong>Maya&apos;s total</strong>
                            <strong>{money(p.totalCharge)}</strong>
                          </div>
                        </div>
                        {p.error && (
                          <div className="closed-offer">
                            <strong>Payment needs attention</strong>
                            <span>{p.error}</span>
                          </div>
                        )}
                        {p.status === "proposed" && (
                          <>
                            <button
                              className="button primary full"
                              disabled={disabled || !allAccepted}
                              onClick={checkout}
                            >
                              {busy ? (
                                <Loader2 className="spin" size={16} />
                              ) : (
                                <CreditCard size={16} />
                              )}{" "}
                              {studio.mode === "practice"
                                ? "Complete practice booking"
                                : "Approve with PayPal"}
                              <ArrowRight size={16} />
                            </button>
                            <p className="fine-print centered">
                              {!allAccepted
                                ? "Waiting for each customer's choice."
                                : studio.mode === "practice"
                                  ? "Simulated charge and refunds. No money moves."
                                  : "The buyer approves a hold first. You confirm the booking next."}
                            </p>
                          </>
                        )}
                        {p.status === "authorized" && (
                          <button
                            className="button primary full"
                            disabled={disabled}
                            onClick={() => act("capture")}
                          >
                            <Check size={17} />
                            Confirm booking & issue refunds
                          </button>
                        )}
                        {["review", "settling"].includes(p.status) && (
                          <button
                            className="button primary full"
                            disabled={disabled}
                            onClick={() => act("reconcile")}
                          >
                            <RotateCcw size={16} />
                            Check payment & refunds
                          </button>
                        )}
                        {p.status === "complete" && (
                          <div className="complete-note">
                            <CheckCheck size={21} />
                            <div>
                              <strong>
                                {studio.mode === "practice"
                                  ? "Practice booking complete"
                                  : "Payment and refunds complete"}
                              </strong>
                              <span>
                                {studio.mode === "practice"
                                  ? "No money moved."
                                  : "Verified against PayPal sandbox."}
                              </span>
                            </div>
                          </div>
                        )}
                        {!p.committed && p.status !== "review" && (
                          <button
                            className="text-button full"
                            onClick={() => act("cancel")}
                            disabled={disabled}
                          >
                            Cancel this offer
                          </button>
                        )}
                        {p.orderId && !p.committed && (
                          <button
                            className="text-button full"
                            onClick={() => act("reconcile")}
                            disabled={disabled || studio.mode === "practice"}
                          >
                            Check existing PayPal payment
                          </button>
                        )}
                      </div>
                    )}
                  </section>
                  <div className="promise-card">
                    <ShieldCheck size={21} />
                    <div>
                      <strong>People first. Always.</strong>
                      <p>
                        No appointment moves until everyone agrees and the new
                        booking is confirmed.
                      </p>
                    </div>
                  </div>
                  <div className="powered-line">
                    <span className="paypal-word">PayPal</span>
                    <span>
                      {studio.mode === "practice"
                        ? "Sandbox connection available"
                        : "Sandbox payments"}
                      <br />
                      Clear approvals. Traceable refunds.
                    </span>
                  </div>
                </aside>
              </div>
            </>
          )}
          {view === "customers" && (
            <>
              <div className="simple-heading">
                <span className="eyebrow">THE PEOPLE IN YOUR DAY</span>
                <h1>On their terms.</h1>
                <p>
                  Review flexibility, then let each customer approve their exact
                  move.
                </p>
              </div>
              <div className="customer-page-grid">
                {studio.bookings.map((b) => (
                  <div key={b.id}>
                    <PreferenceEditor
                      booking={b}
                      busy={disabled}
                      ai={integrations.ai}
                      locked={locked}
                      act={act}
                    />
                    <div className="funding-card">
                      <div>
                        <span>Original prepayment</span>
                        <strong>{money(b.prepaid)}</strong>
                      </div>
                      <span className="pill subtle">
                        {studio.mode === "practice"
                          ? "Practice record"
                          : b.captureId
                            ? "Sandbox payment verified"
                            : "Not yet funded"}
                      </span>
                      {studio.mode === "sandbox" && !b.captureId && (
                        <button
                          className="button secondary small full"
                          disabled={disabled}
                          onClick={() => fund(b.id)}
                        >
                          Fund with PayPal sandbox <ArrowUpRight size={14} />
                        </button>
                      )}
                      {b.captureId && <code>{b.captureId}</code>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          {view === "activity" && (
            <>
              <div className="simple-heading with-action">
                <div>
                  <span className="eyebrow">EVERY STEP, ACCOUNTED FOR</span>
                  <h1>The studio record.</h1>
                  <p>
                    Approvals, booking changes and payment results in one place.
                  </p>
                </div>
                <button
                  className="button secondary"
                  onClick={exportRecord}
                  disabled={!ready}
                >
                  <Download size={16} />
                  Export record
                </button>
              </div>
              {p?.captureId && (
                <div className="receipt-banner">
                  <CreditCard size={24} />
                  <div>
                    <strong>
                      {studio.mode === "practice"
                        ? "Practice payment"
                        : "PayPal sandbox payment"}{" "}
                      · {money(p.totalCharge)}
                    </strong>
                    <code>{p.captureId}</code>
                  </div>
                  <span className="pill subtle">
                    {p.captureStatus?.toLowerCase()}
                  </span>
                </div>
              )}
              <div className="activity-card">
                {studio.events.map((e, i) => (
                  <div className="activity-row" key={e.id}>
                    <span className={"activity-symbol " + e.kind}>
                      {e.kind === "payment" ? (
                        <CreditCard size={17} />
                      ) : e.kind === "consent" ? (
                        <Check size={17} />
                      ) : e.kind === "plan" ? (
                        <Sparkles size={17} />
                      ) : (
                        <Clock3 size={17} />
                      )}
                    </span>
                    <div>
                      <h3>{e.title}</h3>
                      <p>{e.detail}</p>
                      <span>
                        {new Date(e.at).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    {i === 0 && <span className="pill subtle">Latest</span>}
                  </div>
                ))}
              </div>
            </>
          )}
          {view === "settings" && (
            <>
              <div className="simple-heading">
                <span className="eyebrow">READY FOR THE REAL FLOW</span>
                <h1>Make the connections.</h1>
                <p>
                  Practice first, then verify the same journey with sandbox
                  payments.
                </p>
              </div>
              <div className="settings-grid">
                <section className="settings-card">
                  <span className="connection-logo paypal-word">PayPal</span>
                  <span
                    className={
                      "pill " + (integrations.paypal ? "success" : "subtle")
                    }
                  >
                    {integrations.paypal ? "Connected" : "Not connected"}
                  </span>
                  <h2>PayPal sandbox</h2>
                  <p>
                    Authorize the new booking, capture after approval and refund
                    the original payments.
                  </p>
                  <ul>
                    <li>Test accounts only. Live payments are disabled.</li>
                    <li>Fund Alex and Sam before issuing their refunds.</li>
                    <li>Payment and refund results are checked separately.</li>
                  </ul>
                  <button
                    className="button primary full"
                    disabled={
                      disabled ||
                      !integrations.paypal ||
                      !!integrations.guest ||
                      studio.mode === "sandbox"
                    }
                    onClick={() => act("mode", { mode: "sandbox" })}
                  >
                    {studio.mode === "sandbox"
                      ? "Sandbox is active"
                      : "Use PayPal sandbox"}
                    <ArrowRight size={16} />
                  </button>
                  {integrations.guest && (
                    <p>
                      Guest payments are simulated.{" "}
                      <a
                        href="/signin-with-chatgpt?return_to=%2F"
                        target="_top"
                      >
                        Sign in
                      </a>{" "}
                      for a separate PayPal sandbox workspace, or follow the{" "}
                      <a
                        href="https://github.com/Abhinav0905/makeroom#run-locally"
                        target="_blank"
                        rel="noreferrer"
                      >
                        local setup
                      </a>{" "}
                      with your own test accounts.
                    </p>
                  )}
                  {!integrations.paypal && (
                    <details>
                      <summary>Connection instructions</summary>
                      <p>
                        Add <code>PAYPAL_CLIENT_ID</code> and{" "}
                        <code>PAYPAL_CLIENT_SECRET</code> as server secrets. For
                        local development use the ignored <code>.dev.vars</code>{" "}
                        file.
                      </p>
                      <a
                        href="https://developer.paypal.com/dashboard/"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open PayPal Developer <ExternalLink size={12} />
                      </a>
                    </details>
                  )}
                </section>
                <section className="settings-card">
                  <span className="connection-logo ai-symbol">
                    <Sparkles size={29} />
                  </span>
                  <span
                    className={
                      "pill " + (integrations.ai ? "success" : "subtle")
                    }
                  >
                    {integrations.ai ? "Connected" : "Not connected"}
                  </span>
                  <h2>AI preference reader</h2>
                  <p>
                    Turn a customer&apos;s message into specific time and refund
                    terms. Review the interpretation before saving.
                  </p>
                  <ul>
                    <li>Source text stays beside the proposed terms.</li>
                    <li>Missing details trigger a clarification.</li>
                    <li>The planner checks every time and amount.</li>
                  </ul>
                  <div className="model-label">
                    {integrations.ai
                      ? integrations.aiModel
                      : "Reviewed terms work without an AI connection."}
                  </div>
                  {!integrations.ai && (
                    <details>
                      <summary>Connection instructions</summary>
                      <p>
                        Add <code>GEMINI_API_KEY</code> as a server secret and
                        optionally set <code>GEMINI_MODEL</code>. Keys never go
                        in browser code.
                      </p>
                      <a
                        href="https://aistudio.google.com/api-keys"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open Google AI Studio <ExternalLink size={12} />
                      </a>
                    </details>
                  )}
                </section>
                <section className="settings-card practice-settings">
                  <div>
                    <h2>A fresh start.</h2>
                    <p>
                      Reset the fictional studio to try a refusal, a smaller
                      budget or different customer terms. Sandbox payment
                      records are preserved.
                    </p>
                  </div>
                  <button
                    className="button secondary"
                    disabled={disabled || studio.mode !== "practice"}
                    onClick={() => act("reset")}
                  >
                    <RotateCcw size={16} />
                    Reset practice studio
                  </button>
                </section>
              </div>
            </>
          )}
          <footer className="app-footer">
            <span>MakeRoom · A little flexibility. One more booking.</span>
            <span>
              {studio.mode === "practice"
                ? "Fictional studio · Simulated payments"
                : "Test studio · PayPal sandbox only"}
            </span>
          </footer>
        </main>
      </div>
      <dialog
        className="help-dialog"
        ref={helpRef}
        onClose={() => setHelp(false)}
      >
        <button
          className="icon-button dialog-close"
          onClick={() => setHelp(false)}
          aria-label="Close guide"
        >
          <X size={20} />
        </button>
        <span className="eyebrow">MAKE ROOM, TOGETHER</span>
        <h2>
          Three small steps.
          <br />
          One more possibility.
        </h2>
        <ol>
          <li>
            <span>01</span>
            <div>
              <strong>Find an arrangement.</strong>
              <p>
                Start with a requested session and reviewed customer
                flexibility. The planner checks every possible move.
              </p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>Let everyone choose.</strong>
              <p>
                Open each customer&apos;s offer. They see only their new time
                and refund, and can accept or keep their original time.
              </p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <strong>Confirm and give back.</strong>
              <p>
                Approve the new payment, then confirm the booking and issue the
                agreed refunds. Each payment result stays in the studio record.
              </p>
            </div>
          </li>
        </ol>
        <div className="guide-note">
          This preview uses fictional customers. Practice mode simulates
          payments. Sandbox mode sends actual requests to PayPal&apos;s test
          environment.
        </div>
      </dialog>
      {busy && (
        <div className="busy-toast" role="status">
          <Loader2 className="spin" size={17} />
          {busy === "interpret"
            ? "Reading the customer's message…"
            : busy === "plan"
              ? "Checking the possible arrangements…"
              : "Saving your studio…"}
        </div>
      )}
    </div>
  );
}
