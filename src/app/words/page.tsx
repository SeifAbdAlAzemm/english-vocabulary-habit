import Link from "next/link";
import { WordReviews, type WordReview, type ExtraReview } from "@/components/word-reviews";
import { Shell } from "@/components/shell";
import { requireLearner } from "@/lib/supabase/server";
import { loadWords } from "@/lib/data";
import type { Word } from "@/lib/model";

export default async function WordsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const { supabase, user } = await requireLearner();
  const { saved } = await searchParams;
  let words: Word[] = [];
  let error = "";
  try { words = await loadWords(supabase, user.id); } catch (e) { error = e instanceof Error ? e.message : "Could not load words."; }
  const [history, extra] = await Promise.all([
    supabase.from("review_schedule").select("id,word_id,kind,checkpoint,due_date,completed,completed_date,completion_was_late,recall,actual_date,was_late,first_sentence,evaluation_state").eq("user_id", user.id).order("due_date"),
    supabase.from("review_attempts").select("id,word_id,actual_date,recall,review_productions(first_sentence)").eq("user_id", user.id).is("scheduled_date", null).order("attempted_at"),
  ]);
  return <Shell active="words"><div className="page-heading"><div><span className="eyebrow">WORDS YOU’VE WORKED ON</span><h1>My Words</h1><p className="muted">Your meanings, examples, and original sentences. Kept together.</p></div><Link className="button secondary" href="/session">Continue draft →</Link></div>
    {saved === "1" && !error && <p className="success-message" role="status">Your word was saved to Supabase. Reload this page to check it is still here.</p>}
    {error ? <div className="card error-message" role="alert">{error}</div> : !words.length ? <section className="card empty-state"><span className="empty-icon" aria-hidden="true">✧</span><h2>Your first word is a beginning.</h2><p>Start with analysis, then approach. Add your own sentence and come back to find it here.</p><Link className="button" href="/">Start from the Dashboard →</Link></section> : <>
      <div className="section-heading"><p className="muted">{words.length} saved {words.length === 1 ? "word" : "words"} · Newest learning date first</p><span className="pill neutral">Coverage ≠ mastery</span></div>
      <div className="word-list">{words.map(word => <article className="card saved-word" key={word.id}><div className="word-title"><div><span className="eyebrow">{word.part_of_speech}</span><h2>{word.target}</h2></div><span className="word-date">Learned {word.learn_date}</span></div><p className="word-meaning">{word.meaning}</p><div className="sentence-evidence"><span className="eyebrow">MY ORIGINAL FIRST ATTEMPT · PRESERVED</span><p className="preserved-text" dir="auto">{word.first_sentence}</p></div><details><summary>Word details & source</summary><dl><dt>Source example</dt><dd className="preserved-text" dir="auto">{word.source_example}</dd><dt>Source attribution</dt><dd>{/^https?:\/\//i.test(word.source_url) ? <a href={word.source_url} target="_blank" rel="noreferrer">{word.source_url} ↗</a> : word.source_url}</dd>{[["Useful phrase / context", word.context], ["Word family", word.word_family], ["Synonym / difference", word.synonym]].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="preserved-text" dir="auto">{value}</dd></div>)}</dl><p className="fine-print">Feedback Coach, second attempt, and corrected version are coming in Slice 03. No production score or mastery status has been assigned.</p></details>{history.error || extra.error ? <p role="alert">Review history could not be loaded. Saved word evidence is unchanged.</p> : <WordReviews reviews={(history.data as WordReview[]).filter(r => r.word_id === word.id)} extra={(extra.data as ExtraReview[]).filter(a => a.word_id === word.id)} />}</article>)}</div>
    </>}
  </Shell>;
}
