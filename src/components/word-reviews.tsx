export type WordReview = { id: string; word_id: string; kind: string; checkpoint: number | null; due_date: string; completed: boolean; completed_date: string | null; completion_was_late: boolean | null; recall: string | null; actual_date: string | null; was_late: boolean | null; first_sentence: string | null; evaluation_state: string | null };
export type ExtraReview = { id: string; word_id: string; actual_date: string; recall: string; review_productions: { first_sentence: string }[] };

export function WordReviews({ reviews, extra }: { reviews: WordReview[]; extra: ExtraReview[] }) {
  return <details className="mt-4"><summary>Review schedule & immutable first attempts</summary><ul className="review-queue">{reviews.map(r => <li key={r.id}>
    <strong>{r.kind === "milestone" ? `Day +${r.checkpoint}` : "Remedial"}</strong> · Scheduled {r.due_date} · {r.completed ? "Completed" : r.recall ? r.checkpoint === 7 && !r.first_sentence ? "Recall saved; independent sentence pending" : "Recall saved; answer check pending" : "Incomplete"}
    {r.recall && <> · {r.recall} · Recall date {r.actual_date} · {r.was_late ? "Late recall" : "On-time recall"}</>}
    {r.completed && <> · Completed {r.completed_date} · {r.completion_was_late ? "Late completion" : "On-time completion"}</>}
    {r.first_sentence && <p className="preserved-text" dir="auto">First Day +7 sentence: {r.first_sentence} · {r.evaluation_state}; no score assigned.</p>}
  </li>)}</ul>{extra.length > 0 && <><h3>Extra Practice</h3><ul>{extra.map(a => <li key={a.id}>{a.actual_date} · {a.recall}{a.review_productions.map(p => <p className="preserved-text" dir="auto" key={p.first_sentence}>{p.first_sentence}</p>)}</li>)}</ul></>}<p className="fine-print">Incomplete is not Forgot. Extra Practice and remedial reviews are separate from milestone measurements.</p></details>;
}
