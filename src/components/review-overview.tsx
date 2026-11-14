"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { reviewState } from "@/app/review-actions";
import { useLocalDate } from "@/lib/use-local-date";
import type { ReviewState } from "@/lib/reviews";

export function ReviewOverview({ full = false }: { full?: boolean }) {
  const date = useLocalDate();
  const [state, setState] = useState<ReviewState | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!date) return;
    let active = true;
    reviewState(Intl.DateTimeFormat().resolvedOptions().timeZone).then(value => { if (active) { setState(value); setError(""); } }).catch(() => { if (active) setError("Could not load due reviews. Check the connection and Slice 02 migration."); });
    return () => { active = false; };
  }, [date]);
  return <section className="card stack"><span className="eyebrow">RETRIEVE BEFORE YOU REVEAL</span><h2>Today’s reviews</h2>{error ? <p role="alert" className="error-message">{error}</p> : !state ? <p role="status">Loading your local review day…</p> : <>
    <p>{new Set(state.queue.map(c => c.word_id)).size} due words · {state.queue.length} cards · {state.queue.filter(c => c.due_date! < state.today).length} overdue cards</p>
    <p className="fine-print">Overdue reviews stay due. A missed test is incomplete; Forgot means you actually tried. Review dates use your browser timezone.</p>
    {full && <ul className="review-queue">{state.queue.map(card => <li key={card.key}><strong>{card.target}</strong> · {card.due_date} · {card.obligations.map(o => o.kind === "remedial" ? "Remedial" : `Day +${o.checkpoint}`).join(" + ")} · {card.due_date! < state.today ? "Overdue / incomplete" : "Due today"}</li>)}</ul>}
    {state.queue.length === 0 && <p>No scheduled reviews due. You can still do extra practice with saved words.</p>}
  </>}<Link href={full ? "/session" : "/review"} className="text-button">{full ? "Continue your session →" : "Open Review →"}</Link></section>;
}
