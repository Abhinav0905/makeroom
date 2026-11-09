"use client";
import { useState } from "react";
import { Check, Plus, Sparkles, SlidersHorizontal, X } from "lucide-react";
import { time, money, type Booking, type Studio } from "@/lib/domain";
import { MAX_TERMS, canAddTerm, noMoveNote } from "@/lib/terms";
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
/** One editable alternative. Refund is in dollars while editing. */
type Row = { start: number; refund: number; on: boolean; quote?: string };
type Draft = NonNullable<Booking["aiDraft"]>;
const savedRows = (b: Booking): Row[] =>
  b.alternatives.map((a, i) => ({
    start: a.start,
    refund: a.refund / 100,
    on: true,
    quote: b.quotes?.[i] || undefined,
  }));
const draftRows = (d: Draft): Row[] =>
  d.alternatives.map((a, i) => ({
    start: a.start,
    refund: a.refund / 100,
    on: true,
    quote: d.evidence[i] || undefined,
  }));
const move = (from: number, to: number, refund: number) =>
  `${time(from)} → ${time(to)} · ${money(refund)} back`;
export default function PreferenceEditor({
  booking: b,
  busy,
  ai,
  locked,
  act,
}: Props) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState(b.preference);
  const [rows, setRows] = useState<Row[]>(() => savedRows(b));
  const starts = Array.from(
    { length: Math.max(1, (1020 - b.duration - 780) / 15 + 1) },
    (_, i) => 780 + i * 15,
  );
  const draft = b.aiDraft?.message === message ? b.aiDraft : undefined;
  function toggle() {
    if (!open) {
      setMessage(b.preference);
      setRows(savedRows(b));
    }
    setOpen(!open);
  }
  async function analyze() {
    const s = await act("interpret", { bookingId: b.id, message });
    const d = s?.bookings.find((x) => x.id === b.id)?.aiDraft;
    if (d?.alternatives.length) setRows(draftRows(d));
    else if (d && !d.clarification) setRows([]);
  }
  function change(i: number, patch: Partial<Row>) {
    setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    if (!canAddTerm(rows.length)) return;
    const used = new Set(rows.map((r) => r.start));
    const start =
      starts.find((t) => t !== b.start && !used.has(t)) ?? starts[0];
    setRows([...rows, { start, refund: 0, on: true }]);
  }
  async function save() {
    const alternatives = rows
      .filter((r) => r.on)
      .map((r) => ({ start: r.start, refund: Math.round(r.refund * 100) }))
      .filter(
        (a, i, all) =>
          all.findIndex((x) => x.start === a.start && x.refund === a.refund) ===
          i,
      );
    const s = await act("preference", {
      preference: { bookingId: b.id, message, alternatives },
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
            {b.alternatives.length ? (
              <ul className="preference-terms">
                {b.alternatives.map((a, i) => (
                  <li key={i}>
                    → {time(a.start)} · {money(a.refund)} back
                  </li>
                ))}
              </ul>
            ) : (
              <strong>No moves</strong>
            )}
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
          {draft && (
            <div className="ai-draft">
              <span className="eyebrow">AI PROPOSAL · REVIEW REQUIRED</span>
              {draft.clarification ? (
                <p className="ai-ask">
                  <strong>Ask the customer first:</strong>{" "}
                  {draft.clarification}
                </p>
              ) : draft.alternatives.length ? (
                <ul className="ai-moves">
                  {draft.alternatives.map((a, i) => (
                    <li key={i}>
                      <strong>{move(b.start, a.start, a.refund)}</strong>
                      {draft.evidence[i] && (
                        <blockquote>&quot;{draft.evidence[i]}&quot;</blockquote>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{noMoveNote(draft)}</p>
              )}
              {!!draft.rejected?.length && (
                <>
                  <span className="ai-subhead">
                    Set aside by the studio&apos;s checks
                  </span>
                  <ul className="ai-moves rejected">
                    {draft.rejected.map((r, i) => (
                      <li key={i}>
                        <s>{move(b.start, r.start, r.refund)}</s>
                        <span className="ai-reason">{r.reason}</span>
                        {r.evidence && (
                          <blockquote>&quot;{r.evidence}&quot;</blockquote>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          <div
            className="term-list"
            role="group"
            aria-label="Times the customer is open to"
          >
            <span className="term-title">Customer is open to these times</span>
            {rows.length > 0 && (
              <div className="term-row term-head" aria-hidden="true">
                <span />
                <span>New start</span>
                <span>Refund ($)</span>
              </div>
            )}
            {rows.map((r, i) => (
              <div className={"term-row" + (r.on ? "" : " off")} key={i}>
                <input
                  type="checkbox"
                  checked={r.on}
                  onChange={(e) => change(i, { on: e.target.checked })}
                  disabled={locked}
                  aria-label={`Offer ${time(r.start)} for ${money(Math.round(r.refund * 100))} back`}
                />
                <select
                  value={r.start}
                  onChange={(e) =>
                    change(i, { start: +e.target.value, quote: undefined })
                  }
                  disabled={locked}
                  aria-label="New start"
                >
                  {starts.map((t) => (
                    <option value={t} key={t}>
                      {time(t)}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0}
                  max={(b.prepaid - b.refunded) / 100}
                  step={1}
                  value={r.refund}
                  onChange={(e) =>
                    change(i, { refund: +e.target.value, quote: undefined })
                  }
                  disabled={locked}
                  aria-label="Refund in dollars"
                />
                {r.quote && !draft && message === b.preference && (
                  <blockquote>&quot;{r.quote}&quot;</blockquote>
                )}
              </div>
            ))}
            {!rows.length && (
              <p className="term-empty">
                No other times. The original booking stays.
              </p>
            )}
            <button
              type="button"
              className="text-button add-time"
              onClick={addRow}
              disabled={locked || !canAddTerm(rows.length)}
            >
              <Plus size={12} /> Add another time
            </button>
            {!canAddTerm(rows.length) && (
              <p className="term-empty">
                Up to {MAX_TERMS} times per customer.
              </p>
            )}
          </div>
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
