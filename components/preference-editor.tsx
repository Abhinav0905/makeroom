"use client";
import { useState } from "react";
import { Check, Sparkles, SlidersHorizontal, X } from "lucide-react";
import { time, money, type Booking, type Studio } from "@/lib/domain";
type Props = {
  booking: Booking;
  busy: boolean;
  ai: boolean;
  locked: boolean;
  act: (
    action: string,
    data?: Record<string, unknown>,
  ) => Promise<Studio | null>;
};
export default function PreferenceEditor({
  booking: b,
  busy,
  ai,
  locked,
  act,
}: Props) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState(b.preference);
  const [start, setStart] = useState(b.alternatives[0]?.start ?? 780);
  const [refund, setRefund] = useState((b.alternatives[0]?.refund ?? 0) / 100);
  const [flexible, setFlexible] = useState(!!b.alternatives.length);
  function toggle() {
    if (!open) {
      setMessage(b.preference);
      setStart(b.alternatives[0]?.start ?? 780);
      setRefund((b.alternatives[0]?.refund ?? 0) / 100);
      setFlexible(!!b.alternatives.length);
    }
    setOpen(!open);
  }
  async function analyze() {
    const s = await act("interpret", { bookingId: b.id, message });
    const d = s?.bookings.find((x) => x.id === b.id)?.aiDraft;
    if (d?.alternatives.length) {
      setStart(d.alternatives[0].start);
      setRefund(d.alternatives[0].refund / 100);
      setFlexible(true);
    } else if (d && !d.clarification) setFlexible(false);
  }
  async function save() {
    const s = await act("preference", {
      preference: {
        bookingId: b.id,
        message,
        alternatives: flexible
          ? [{ start, refund: Math.round(refund * 100) }]
          : [],
      },
    });
    if (s) setOpen(false);
  }
  return (
    <article className="preference-card">
      <div className="preference-top">
        <span className={"avatar " + b.color}>{b.initials}</span>
        <div>
          <h3>{b.name}</h3>
          <span>
            {time(b.start)} · {b.service}
          </span>
        </div>
        <button
          className="icon-button"
          aria-label={
            open ? "Close terms for " + b.name : "Edit terms for " + b.name
          }
          onClick={toggle}
        >
          {open ? <X size={17} /> : <SlidersHorizontal size={17} />}
        </button>
      </div>
      {!open ? (
        <>
          <p className="customer-quote">&quot;{b.preference}&quot;</p>
          <div className="preference-bottom">
            <span className="tiny-check">
              <Check size={13} />
              {b.preferenceSource === "ai"
                ? "AI terms reviewed"
                : "Reviewed terms"}
            </span>
            <strong>
              {b.alternatives.length
                ? money(Math.min(...b.alternatives.map((a) => a.refund))) +
                  " back"
                : "No moves"}
            </strong>
          </div>
        </>
      ) : (
        <div className="preference-form">
          <label>
            Customer&apos;s message
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={1500}
              disabled={locked}
              rows={3}
            />
          </label>
          <button
            className="button secondary small full"
            onClick={analyze}
            disabled={busy || locked || !ai}
          >
            <Sparkles size={14} />
            {ai ? "Read with AI" : "AI connection needed"}
          </button>
          {b.aiDraft?.message === message && (
            <div className="ai-draft">
              <span className="eyebrow">AI PROPOSAL · REVIEW REQUIRED</span>
              <p>{b.aiDraft.explanation}</p>
              {b.aiDraft.clarification && (
                <strong>{b.aiDraft.clarification}</strong>
              )}
              {b.aiDraft.evidence.slice(0, 1).map((e, i) => (
                <blockquote key={i}>&quot;{e}&quot;</blockquote>
              ))}
            </div>
          )}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={flexible}
              onChange={(e) => setFlexible(e.target.checked)}
              disabled={locked}
            />
            Customer is open to this alternative
          </label>
          {flexible && (
            <div className="form-two">
              <label>
                New start
                <select
                  value={start}
                  onChange={(e) => setStart(+e.target.value)}
                  disabled={locked}
                >
                  {Array.from({ length: 13 }, (_, i) => 780 + i * 15).map(
                    (t) => (
                      <option value={t} key={t}>
                        {time(t)}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                Refund ($)
                <input
                  type="number"
                  min={0}
                  max={(b.prepaid - b.refunded) / 100}
                  step={1}
                  value={refund}
                  onChange={(e) => setRefund(+e.target.value)}
                  disabled={locked}
                />
              </label>
            </div>
          )}
          <button
            className="button primary small full"
            onClick={save}
            disabled={
              busy ||
              locked ||
              (!!b.aiDraft?.clarification && b.aiDraft.message === message)
            }
          >
            Save reviewed terms <Check size={14} />
          </button>
          <p className="fine-print">
            Saving changes replaces any earlier offer. The customer still
            approves the final move.
          </p>
        </div>
      )}
    </article>
  );
}
