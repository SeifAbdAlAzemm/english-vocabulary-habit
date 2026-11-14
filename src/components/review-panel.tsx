"use client";

import { useEffect, useState } from "react";
import { finishReview, revealReview, reviewState, submitReview } from "@/app/review-actions";
import type { Session } from "@/lib/model";
import type { ReviewCard, ReviewState } from "@/lib/reviews";
import { useLocalDate } from "@/lib/use-local-date";

type Result = { error?: string };
type Props = {
  session: Session; disabled: boolean;
  run: (operation: (snapshot: Session) => Promise<Result>) => Promise<boolean>;
  draft: (review: NonNullable<Session["draft"]["review"]>) => void;
  onState: (state: ReviewState) => void;
};

export function ReviewPanel({ session, disabled, run, draft, onState }: Props) {
  const date = useLocalDate();
  const [state, setState] = useState<ReviewState | null>(null);
  const [extra, setExtra] = useState("");
  const [practisingExtra, setPractisingExtra] = useState(false);
  const [answer, setAnswer] = useState<{ target: string; meaning: string; source_example: string } | null>(null);
  const [error, setError] = useState("");
  const [selectedAttempt, setSelectedAttempt] = useState<string | null>(null);
  const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
  async function reload() {
    const value = await reviewState(timezone(), session.id);
    setState(value); onState(value);
    return value;
  }
  useEffect(() => {
    let active = true;
    reviewState(timezone(), session.id).then(value => { if (active) { setState(value); onState(value); } }).catch(() => { if (active) setError("Could not load reviews. Retry loading before continuing."); });
    return () => { active = false; };
    // Callbacks use the same mounted editor; calendar changes refresh due status.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, date]);

  if (!state) return <section className="stack"><p role="status">Loading review obligations…</p>{error && <p role="alert">{error}</p>}<button className="text-button" onClick={() => void reload().catch(() => setError("Could not load reviews."))}>Retry review loading</button></section>;

  const pending = state.attempts.find(a => !a.review_feedback.length);
  const attempt = state.attempts.find(a => a.id === selectedAttempt) ?? pending;
  const dueCards = session.session_type === "MVD" && session.mvd_path === "due" ? state.queue.filter(c => session.mvd_targets.includes(c.word_id)) : state.queue;
  const oldWord = state.oldWords.find(w => w.id === extra) ?? state.oldWords.find(w => session.session_type !== "MVD" || session.mvd_targets.includes(w.id));
  const extraCard: ReviewCard | null = oldWord ? { key: `extra:${oldWord.id}`, word_id: oldWord.id, target: oldWord.target, part_of_speech: oldWord.part_of_speech, due_date: null, obligations: [] } : null;
  const card = dueCards[0] ?? ((session.session_type === "review" || session.mvd_path === "extra" || practisingExtra) ? extraCard : null);
  const key = attempt ? `attempt:${attempt.id}` : card?.key ?? "";
  const sentence = session.draft.review?.key === key ? session.draft.review.sentence : "";
  const needsSentence = attempt ? attempt.requires_sentence && !attempt.review_productions.length : card?.obligations.some(o => o.checkpoint === 7);
  const target = attempt ? state.oldWords.find(w => w.id === attempt.word_id)?.target : card?.target;
  function changeSentence(value: string) { draft({ key, id: session.draft.review?.key === key ? session.draft.review.id : crypto.randomUUID(), sentence: value }); }

  async function record(recall: "remembered" | "forgot") {
    if (!card) return;
    const id = session.draft.review?.key === key ? session.draft.review.id : crypto.randomUUID();
    draft({ key, id, sentence });
    let savedId: string | undefined;
    const ok = await run(async s => {
      const result = await submitReview({ id, sessionId: s.id, version: s.version, wordId: card.word_id, due: card.due_date, recall, sentence, timezone: timezone(), intervals: s.intervals });
      savedId = result.id; return result;
    });
    if (!ok) return;
    setSelectedAttempt(savedId!); setAnswer(null);
    await reload();
  }
  async function production() {
    if (!attempt) return;
    const ok = await run(s => finishReview(attempt.id, s.id, s.version, sentence, false, timezone()));
    if (ok) await reload();
  }
  async function reveal() {
    if (!attempt) return;
    const result = await revealReview(attempt.id);
    if (result.error) setError(result.error); else { setAnswer(result.answer!); setError(""); }
  }
  async function acknowledge() {
    if (!attempt) return;
    const ok = await run(s => finishReview(attempt.id, s.id, s.version, "", true, timezone()));
    if (ok) { setAnswer(null); setSelectedAttempt(null); await reload(); }
  }
  return <section className="stack review-panel">
    <div><span className="eyebrow">FIRST / RETRIEVE</span><h2>{session.session_type === "MVD" ? "Minimum Viable Day" : "Review before new words"}</h2>
      <p>{state.queue.length} due cards remaining · {state.queue.filter(c => c.due_date! < state.today).length} overdue · {new Set(state.queue.map(c => c.word_id)).size} distinct due words</p>
      {session.session_type === "MVD" && <p className="notice">{session.mvd_path === "due" ? `Test ${session.mvd_targets.length} distinct due words, then check the answers. Other reviews stay due.` : session.mvd_path === "extra" ? "No words were due at start. Test two saved words, or one saved word plus a new independent sentence. Logged as Extra Practice." : "Your first day: learn one word with a meaning, source example and your own sentence."} Around five minutes is guidance.</p>}
      {state.today !== session.local_date && <p className="notice">This draft started on {session.local_date}. Attempts use today’s actual date. Close unfinished and start today’s MVD to earn today’s qualifying completion.</p>}
    </div>
    {attempt ? <div className="stack">
      <div className="target-prompt"><span className="eyebrow">FIRST RESULT SAVED · {attempt.recall}</span><strong>{target}</strong></div>
      <p>{attempt.scheduled_date ? `Scheduled ${attempt.scheduled_date}` : "Extra Practice"} · Actual {attempt.actual_date}{attempt.was_late ? " · Late" : ""}</p>
      {attempt.recall === "forgot" && <p>A remedial review was scheduled for the next local day. Milestones are unchanged.</p>}
      {needsSentence ? <><p>Day +7 is still incomplete. Save a new independent sentence before revealing the answer.</p><label>New independent sentence<textarea dir="auto" maxLength={5000} value={sentence} onChange={e => changeSentence(e.target.value)} /></label><button className="button" disabled={disabled || !sentence.trim()} onClick={() => void production()}>Save Day +7 first sentence</button></> : <>
        {!!attempt.review_productions.length && <p className="preserved-text" dir="auto">First production: {attempt.review_productions[0].first_sentence} · Pending evaluation (no score assigned).</p>}
        {!answer ? <button className="button" disabled={disabled} onClick={() => void reveal()}>Reveal saved answer</button> : <div className="notice stack"><h3>{answer.target}</h3><p data-testid="review-meaning">{answer.meaning}</p><p>{answer.source_example}</p><p>Check your recall and correct mistakes. Try retrieving it again after other cards as Extra Practice; your first result stays unchanged.</p><button className="button" disabled={disabled} onClick={() => void acknowledge()}>I checked the answer and corrected mistakes</button></div>}
      </>}
    </div> : card && (!state.qualified || practisingExtra) ? <div className="stack">
      {!card.due_date && <label>Extra Practice word<select value={oldWord?.id} onChange={e => { setExtra(e.target.value); setAnswer(null); }}>{state.oldWords.filter(w => session.session_type !== "MVD" || session.mvd_targets.includes(w.id)).map(w => <option key={w.id} value={w.id}>{w.target}</option>)}</select></label>}
      <p className="fine-print">{card.due_date ? `${card.due_date} · ${card.obligations.map(o => o.kind === "remedial" ? "Remedial" : `Day +${o.checkpoint}`).join(" + ")} · ${card.due_date < state.today ? "Overdue" : "Due today"}` : "Extra Practice · excluded from milestone metrics"}</p>
      <div className="target-prompt"><span className="eyebrow">{card.part_of_speech}</span><strong>{card.target}</strong></div>
      <p>Recall the primary meaning in Arabic or English, without help. Then record your first result. Your meaning and example remain hidden until the attempt is saved.</p>
      {(needsSentence || !card.due_date) && <label>New independent sentence {needsSentence ? "(required for Day +7)" : "(optional; one word + sentence qualifies for MVD)"}<textarea dir="auto" value={sentence} maxLength={5000} onChange={e => changeSentence(e.target.value)} /></label>}
      <div className="review-decisions"><button className="button" disabled={disabled || Boolean(needsSentence && !sentence.trim())} onClick={() => void record("remembered")}>Remembered</button><button className="button secondary" disabled={disabled || Boolean(needsSentence && !sentence.trim())} onClick={() => void record("forgot")}>Forgot</button></div>
    </div> : <p>{state.qualified ? "Required practice and feedback are recorded. You can finish this session below." : state.queue.length === 0 ? "No scheduled reviews due." : "Your MVD target cards have been attempted. Check any pending feedback."}</p>}
    <div className="notice"><strong>Session summary</strong><p>{state.attempts.length} recall attempts · {state.attempts.filter(a => a.recall === "remembered").length} Remembered · {state.attempts.filter(a => a.recall === "forgot").length} Forgot · {state.queue.length} due cards remaining</p><p className="fine-print">First results are preserved. Day +7 production awaits the Feedback Coach; no score is invented.</p></div>
    {error && <p className="error-message" role="alert">{error}</p>}
    <button className="text-button" disabled={disabled} onClick={() => void reload().catch(() => setError("Could not refresh reviews."))}>Refresh review queue</button>
    {state.queue.length === 0 && state.oldWords.length > 0 && session.session_type !== "MVD" && <button className="text-button" disabled={disabled} onClick={() => { setSelectedAttempt(null); setAnswer(null); setPractisingExtra(true); }}>Do additional Extra Practice</button>}
  </section>;
}
