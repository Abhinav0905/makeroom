"use client";
import { ArrowRight, Check, Clock3 } from "lucide-react";
import { time, money, type Studio } from "@/lib/domain";
export default function StudioCalendar({ studio }: { studio: Studio }) {
  const p = studio.plan;
  const active = p && !["declined", "expired", "cancelled"].includes(p.status);
  const original = studio.bookings.map((b) => ({
    ...b,
    start: p?.moves.find((m) => m.bookingId === b.id)?.from ?? b.start,
  }));
  const proposed = studio.bookings.map((b) => ({
    ...b,
    start: active
      ? (p.moves.find((m) => m.bookingId === b.id)?.to ?? b.start)
      : b.start,
  }));
  const blocks = (after: boolean) => {
    const bs = after ? proposed : original;
    const items = bs.map((b) => ({
      id: b.id,
      name: b.name,
      service: b.service,
      start: b.start,
      duration: b.duration,
      color: b.color,
      tag:
        after && active ? p.moves.find((m) => m.bookingId === b.id) : undefined,
    }));
    if (after && active)
      items.push({
        id: "request",
        name: p.request.name,
        service: p.request.service,
        start: p.request.start,
        duration: p.request.duration,
        color: "forest",
        tag: undefined,
      });
    const free: number[] = [];
    for (let t = 780; t < 1020; t += 60)
      if (!items.some((b) => b.start < t + 60 && t < b.start + b.duration))
        free.push(t);
    return (
      <div className="calendar-lane">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div
            className="calendar-line"
            style={{ top: i * 12.5 + "%" }}
            key={i}
          />
        ))}
        {free.map((t) => (
          <div
            key={t}
            className="free-slot"
            style={{ top: ((t - 780) / 240) * 100 + "%", height: "25%" }}
          >
            <span>Available</span>
            <small>60 minutes</small>
          </div>
        ))}
        {items.map((b) => (
          <div
            key={b.id}
            className={
              "calendar-booking " +
              b.color +
              (after && active ? " shifted" : "")
            }
            style={{
              top: ((b.start - 780) / 240) * 100 + "%",
              height: "calc(" + (b.duration / 240) * 100 + "% - 4px)",
            }}
          >
            <div className="booking-time">
              <Clock3 size={11} />
              {time(b.start)} – {time(b.start + b.duration)}
            </div>
            <strong>{b.name}</strong>
            <span className="booking-service">{b.service}</span>
            {b.id === "request" ? (
              <span className="booking-tag">
                <Check size={12} />
                {p?.committed ? "Confirmed" : "Space created"}
              </span>
            ) : b.tag ? (
              <span className="booking-tag">
                {money(b.tag.refund)} back ·{" "}
                {b.tag.consent === "accepted" ? "accepted" : "proposed"}
              </span>
            ) : (
              <span className="booking-tag">Prepaid session</span>
            )}
          </div>
        ))}
        {after && !active && (
          <div className="calendar-empty-overlay">
            <div className="empty-outline">
              <ArrowRight size={23} />
            </div>
            <strong>
              A little flexibility
              <br />
              can make room.
            </strong>
            <p>
              Find an arrangement to see
              <br />
              your proposed day here.
            </p>
          </div>
        )}
      </div>
    );
  };
  return (
    <section className="calendar-card">
      <div className="section-top">
        <div>
          <span className="eyebrow">THE DAY AT A GLANCE</span>
          <h2>Your studio, reimagined.</h2>
        </div>
        <span className="pill subtle">
          <span className="dot" />
          Studio 01
        </span>
      </div>
      <div className="calendar-columns">
        <div />
        <div className="lane-heading">
          <span>{p?.committed ? "Before" : "Current day"}</span>
          <small>Original appointments</small>
        </div>
        <div className="lane-heading proposed-heading">
          <span>
            {p?.committed ? "Confirmed day" : "With MakeRoom"}
            <ArrowRight size={15} />
          </span>
          <small>
            {active
              ? p.committed
                ? "Everyone has a place."
                : "Pending customer approval"
              : "The proposed arrangement"}
          </small>
        </div>
      </div>
      <div className="calendar-grid">
        <div className="time-axis">
          {[780, 840, 900, 960, 1020].map((t, i) => (
            <span style={{ top: i * 25 + "%" }} key={t}>
              {time(t).replace(":00", "")}
            </span>
          ))}
        </div>
        {blocks(false)}
        {blocks(true)}
      </div>
      <div className="calendar-legend">
        <span>
          <i className="swatch apricot" />
          Alex
        </span>
        <span>
          <i className="swatch sage" />
          Sam
        </span>
        <span>
          <i className="swatch forest" />
          New booking
        </span>
        <span className="timezone">Pacific time · Nov 12</span>
      </div>
    </section>
  );
}
