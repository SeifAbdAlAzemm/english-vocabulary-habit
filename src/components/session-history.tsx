import Link from "next/link";
import type { Session, WordInput } from "@/lib/model";
import { activeMilliseconds, formatTime } from "@/lib/stopwatch";

export type HistoricalSession = Session & { words: { count: number }[] };

const fields: [keyof WordInput, string][] = [
  ["target", "Unsubmitted target word"], ["learn_date", "Learning date"],
  ["meaning", "Meaning draft"], ["part_of_speech", "Part of speech"],
  ["source_example", "Source example"], ["source_url", "Source attribution"],
  ["context", "Useful context"], ["word_family", "Word family"],
  ["synonym", "Synonym"], ["first_sentence", "Unsubmitted sentence draft"],
];

export function SessionHistory({ sessions }: { sessions: HistoricalSession[] }) {
  return <section className="section stack">
    <div><h2>Session history</h2><p className="muted">Most recent 20 closed sessions. Unfinished work is preserved here; saved words remain in <Link href="/words">My Words</Link>.</p></div>
    {sessions.length === 0 ? <p className="muted">No closed sessions yet.</p> : sessions.map(session => <article className="card" key={session.id}>
      <div className="section-heading"><h3>{session.local_date} · {session.session_type === "review" ? "Review" : "Learning"}</h3><span className="pill neutral">Closed unfinished</span></div>
      <p className="muted">{session.words[0]?.count ?? 0}/{session.chosen_words} selected words saved · {formatTime(activeMilliseconds(session.intervals))} active time · Plan: 2 words / learning day</p>
      <details className="mt-4"><summary>Preserved unfinished work · read-only</summary><p className="fine-print">Closed {session.closed_at ? new Date(session.closed_at).toISOString() : ""}. This is not a completed session, MVD, or active-day award.</p><dl>
        {fields.filter(([field]) => session.draft[field]).map(([field, label]) => <div key={field}><dt>{label}</dt><dd className="preserved-text" dir="auto">{session.draft[field]}</dd></div>)}
      </dl>{!session.draft.target && !session.draft.first_sentence && <p>No unfinished word or sentence text was recorded.</p>}</details>
    </article>)}
  </section>;
}
