"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { closeSession, saveWord, syncSession } from "@/app/actions";
import { AWL_SOURCE, emptyWord, isReviewDay, PARTS_OF_SPEECH, type Session, type WordInput } from "@/lib/model";
import { activeMilliseconds, formatTime, heartbeat, validIntervals } from "@/lib/stopwatch";

type LocalCopy = { session: Session; savedAt: number };

export function SessionEditor({ initial, savedIds }: { initial: Session; savedIds: string[] }) {
  const router = useRouter();
  const [session, setSession] = useState(initial);
  const current = useRef(initial);
  const ownsEditor = useRef(false);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const lastTick = useRef(0);
  const [locked, setLocked] = useState(true);
  const [writing, setWriting] = useState(initial.draft.stage === "sentence");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState("Recovering your draft. Close other tabs with this session if you are waiting.");
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState<Session | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const storageKey = `vocabulary-habit:${initial.user_id}:${initial.id}`;
  const queue = useRef(Promise.resolve());
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const conflict = useRef(false);

  function persist(next: Session) {
    if (!ownsEditor.current) return;
    current.current = next;
    setSession(next);
    try { localStorage.setItem(storageKey, JSON.stringify({ session: next, savedAt: Date.now() })); }
    catch { setError("Browser storage is unavailable. Keep this page open until cloud sync succeeds."); }
  }
  function sync() {
    queue.current = queue.current.catch(() => {}).then(async () => {
      if (!ownsEditor.current || busyRef.current || conflict.current) return;
      const next = current.current;
      setMessage("Saving draft…");
      try {
        const result = await syncSession(next.id, next.version, { intervals: next.intervals, draft: next.draft, chosen_words: next.chosen_words, exceptional_learning: next.exceptional_learning });
        if (result.error) {
          if (result.error.includes("changed elsewhere")) conflict.current = true;
          setError(result.error); setMessage("Cloud sync pending");
        } else {
          persist({ ...current.current, version: result.version! });
          setMessage("Draft synced to Supabase"); setError("");
        }
      } catch { setMessage("Cloud sync pending"); setError("Connection interrupted. Your draft is kept on this browser. Retry sync when connected."); }
    });
    return queue.current;
  }
  function scheduleSync() {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void sync(), 800);
  }
  function pause() {
    if (!ownsEditor.current) return;
    runningRef.current = false; setRunning(false);
    persist(current.current); void sync();
  }
  function resume() {
    if (!ownsEditor.current) return;
    if (!navigator.onLine) { setError("Reconnect before resuming active study."); return; }
    const now = Math.max(Date.now(), (current.current.intervals.at(-1)?.end ?? 0) + 1);
    persist({ ...current.current, intervals: [...current.current.intervals, { start: now, end: now }] });
    lastTick.current = performance.now();
    runningRef.current = true; setRunning(true); setError("");
  }

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    let release: (() => void) | undefined;
    async function initialize() {
      let recovered = { ...initial, draft: { ...emptyWord(), ...initial.draft } };
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const local = JSON.parse(raw) as LocalCopy;
          if (local.session?.id === initial.id && local.session.user_id === initial.user_id && validIntervals(local.session.intervals) && local.session.draft && typeof local.session.draft === "object") {
            if (savedIds.includes(String(local.session.draft.id))) {
              recovered = { ...initial, draft: emptyWord() };
              localStorage.removeItem(`${storageKey}:recovery`);
            } else if (local.session.version === initial.version) {
              recovered = { ...local.session, version: initial.version, draft: { ...emptyWord(), ...local.session.draft } };
            } else if (Object.values(local.session.draft).some(Boolean)) {
              localStorage.setItem(`${storageKey}:recovery`, raw);
              setRecovery(local.session);
            }
          }
        }
        const backup = localStorage.getItem(`${storageKey}:recovery`);
        if (backup) setRecovery((JSON.parse(backup) as LocalCopy).session);
      } catch { setError("Local recovery is unavailable. The latest cloud draft is loaded."); }
      if (disposed) return;
      ownsEditor.current = true;
      setLocked(false); persist(recovered); setWriting(recovered.draft.stage === "sentence"); setMessage("Draft restored · timer paused");
      const shouldStart = sessionStorage.getItem("start-next-session") === "yes";
      sessionStorage.removeItem("start-next-session");
      if (shouldStart) resume();
    }
    if (navigator.locks) {
      void navigator.locks.request(`vocabulary-habit:${initial.id}`, { signal: controller.signal }, async () => {
        if (disposed) return;
        await initialize();
        await new Promise<void>(resolve => { release = resolve; if (disposed) resolve(); });
      }).catch(() => { if (!disposed) setError("Could not lock this draft. Close other session tabs and reload."); });
    } else { void initialize(); }
    const tick = setInterval(() => {
      if (!runningRef.current) return;
      const now = performance.now();
      const result = heartbeat(current.current.intervals, now - lastTick.current);
      lastTick.current = now;
      persist({ ...current.current, intervals: result.intervals });
      if (!result.running) pause();
    }, 1000);
    const cloudTick = setInterval(() => { if (runningRef.current) void sync(); }, 10000);
    const onHidden = () => { if (document.hidden && runningRef.current) pause(); };
    const onLeave = () => { if (runningRef.current) pause(); };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onLeave); window.addEventListener("offline", onLeave);
    return () => {
      disposed = true; ownsEditor.current = false; controller.abort(); release?.(); runningRef.current = false;
      clearInterval(tick); clearInterval(cloudTick); clearTimeout(debounce.current);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onLeave); window.removeEventListener("offline", onLeave);
    };
    // This editor owns a single server snapshot for its mounted lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function change(field: keyof WordInput, value: string) {
    persist({ ...current.current, draft: { ...current.current.draft, [field]: value } });
    scheduleSync();
  }
  function changeStage(stage: "notes" | "sentence") {
    setWriting(stage === "sentence");
    persist({ ...current.current, draft: { ...current.current.draft, stage } });
    scheduleSync();
  }
  async function closeUnfinished() {
    if (!ownsEditor.current || busyRef.current || recovery) return;
    busyRef.current = true;
    runningRef.current = false; setRunning(false);
    clearTimeout(debounce.current); setBusy(true); setError("");
    persist(current.current);
    await queue.current;
    try {
      const result = await closeSession(current.current.id, current.current.version, {
        draft: current.current.draft, intervals: current.current.intervals,
        chosen_words: current.current.chosen_words, exceptional_learning: current.current.exceptional_learning,
      });
      if (result.error) setError(result.error);
      else {
        // Stop any late callbacks from rewriting the now-closed local snapshot.
        ownsEditor.current = false;
        localStorage.removeItem(storageKey); localStorage.removeItem(`${storageKey}:recovery`);
        router.push("/session?closed=1"); router.refresh();
      }
    } catch { setError("Closing could not be confirmed. Your local copy is kept. Retry without changing the draft, or reload and check Session history."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    runningRef.current = false; setRunning(false);
    clearTimeout(debounce.current); setBusy(true); setError("");
    await queue.current;
    try {
      const result = await saveWord(current.current.id, current.current.version, current.current.draft, current.current.intervals);
      if (result.error) { setError(result.error); setMessage("Word not saved · draft kept"); }
      else {
        localStorage.removeItem(storageKey); localStorage.removeItem(`${storageKey}:recovery`);
        router.push("/words?saved=1"); router.refresh();
      }
    } catch { setError("Save could not be confirmed. Your original draft is kept. Retry safely; the same word won’t be inserted twice."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  const word = session.draft;
  const atWordLimit = savedIds.length >= session.chosen_words;
  const canLearn = (session.session_type === "learning" && !isReviewDay(word.learn_date ?? session.local_date)) || session.exceptional_learning;
  const input = (field: keyof WordInput, label: string, required = false, multiline = false) => <label key={field}>{label}{!required && <span className="optional">optional</span>}{multiline ? <textarea rows={3} value={word[field] ?? ""} maxLength={5000} required={required} onChange={e => change(field, e.target.value)} /> : <input value={word[field] ?? ""} maxLength={field === "target" ? 100 : 5000} type={field === "learn_date" ? "date" : field === "source_url" ? "url" : "text"} required={required} onChange={e => change(field, e.target.value)} />}</label>;
  return <>
    <div className="session-layout"><aside className="session-aside"><section className="card timer-card"><span className="eyebrow">ACTIVE STUDY TIME</span><div className="stopwatch" role="timer" aria-label="Active study time">{formatTime(activeMilliseconds(session.intervals))}</div><span className={`timer-status ${running ? "is-running" : ""}`}><i />{running ? "Focus time" : "Paused"}</span><button className="button secondary" disabled={locked || busy} onClick={running ? pause : resume}>{running ? "Pause stopwatch" : "Resume stopwatch"}</button><p className="fine-print">Pauses, hidden tabs, offline time, and time away after reload are excluded. Recovery always starts paused.</p></section><section className="card"><span className="eyebrow">KEEP THE PLAN SIMPLE</span><h3>Planned: 2 words / learning day</h3><p>Sunday–Thursday. A one-off choice keeps the plan unchanged.</p><label>Words to work on this session<select value={session.chosen_words} disabled={locked || busy} onChange={e => { persist({ ...current.current, chosen_words: Number(e.target.value) }); scheduleSync(); }}>{[1, 2, 3].map(n => <option key={n} value={n} disabled={n < savedIds.length}>{n} {n === 1 ? "word" : "words"}</option>)}</select></label><p className="fine-print">Saved in this draft: {savedIds.length}. Session remains unfinished.</p></section><p className="fine-print" role="status">{message}</p><button className="text-button" disabled={locked || busy} onClick={() => void sync()}>Retry draft sync</button></aside>
    <section className="card word-entry">
      {locked ? <p className="notice" role="status">{message}</p> : <>
        {recovery && <div className="notice"><p>A local draft differs from the cloud copy. Your local copy is kept separately. Restore it only if it is the work you want to continue.</p><button className="text-button" disabled={busy} onClick={() => { persist({ ...current.current, draft: recovery.draft, intervals: recovery.intervals }); setWriting(recovery.draft.stage === "sentence"); setRecovery(null); localStorage.removeItem(`${storageKey}:recovery`); conflict.current = false; scheduleSync(); }}>Restore local work</button><button className="text-button" onClick={() => { localStorage.removeItem(`${storageKey}:recovery`); setRecovery(null); }}>Keep cloud copy</button></div>}
        {atWordLimit && <div className="notice"><strong>Selected word count reached: {savedIds.length}/{session.chosen_words}.</strong><p>Increase the selection up to 3 to add another word, or close this unfinished session. Reaching this count does not complete the approved routine.</p></div>}
        {!canLearn ? <div className="stack"><span className="eyebrow">REVIEW-ONLY SESSION</span><h2>Today is for retrieval.</h2><p>Review practice is coming soon. This draft is not a completed review or active day.</p><button className="button secondary" disabled={busy} onClick={() => { persist({ ...current.current, exceptional_learning: true }); scheduleSync(); }}>Choose exceptional new-word study</button></div> : <form onSubmit={save}>
          <fieldset disabled={busy} className="stack"><div className="section-heading"><div><span className="eyebrow">{writing ? "02 / INDEPENDENT PRODUCTION" : "01 / UNDERSTAND YOUR WORD"}</span><h2>{writing ? "Make it your own." : "One word, understood well."}</h2></div><span className="pill neutral">Draft</span></div>
            {!writing ? <>
              <p>Use <a href={AWL_SOURCE} target="_blank" rel="noreferrer">IELTS Tutors’ Academic Word List ↗</a>. Start afresh with <strong>analysis</strong>, then <strong>approach</strong>. Entry is manual; AWL order is not automatically validated.</p>
              <div className="form-grid">{input("target", "Target word", true)}{input("learn_date", "Learning date", true)}</div>
              <div className="form-grid">{input("meaning", "Primary meaning", true, true)}<label>Part of speech<select value={word.part_of_speech ?? "noun"} onChange={e => change("part_of_speech", e.target.value)}>{PARTS_OF_SPEECH.map(p => <option key={p}>{p}</option>)}</select></label></div>
              <div className="notice"><strong>Listen, say, try again.</strong><p>Listen to pronunciation at your source, say the word aloud, then try without audio. Pronunciation is not assessed here.</p></div>
              {input("source_example", "One source example", true, true)}{input("source_url", "Source attribution / URL", true)}{input("context", "Useful phrase or context")}
              <div className="form-grid">{input("word_family", "One useful word-family form")}{input("synonym", "One synonym + usage difference")}</div>
              <button type="button" className="button" onClick={e => { if (e.currentTarget.form?.reportValidity()) { changeStage("sentence"); window.scrollTo({ top: 0, behavior: "smooth" }); } }}>Hide notes & write my sentence →</button>
            </> : <>
              <div className="target-prompt"><span className="eyebrow">YOUR TARGET WORD</span><strong>{word.target}</strong></div>
              <p>Your definition and source example are hidden. Write one original sentence from your own life, using only the target word. Keep it yours, even if it has mistakes.</p>
              {input("first_sentence", "My first sentence", true, true)}
              <p className="fine-print">Saved exactly as written, including spacing and mistakes. It cannot be overwritten later. Feedback and self-correction are coming in the next slice.</p>
              <button className="button" disabled={busy || atWordLimit}>{busy ? "Saving to Supabase…" : "Save word to My Words →"}</button><button type="button" className="text-button" onClick={() => changeStage("notes")}>Back to my notes</button>
            </>}
          </fieldset>
        </form>}
      </>}
      {error && <p role="alert" className="error-message">{error}</p>}
    </section></div>
    <div className="notice slice-note"><strong>This is an unfinished routine.</strong> Saving a word preserves your work; it does not complete a session, MVD, or active-day record. Feedback, due reviews, quick recall, and session completion are coming soon. <Link href="/words" onClick={pause}>Pause & view My Words →</Link></div>
    <section className="card section stack">
      <div><h3>Stop here and keep your work</h3><p>Closing stores your unsaved text and active time in read-only Session history. Saved words stay in My Words. You can then start a fresh session; this one will be marked closed unfinished.</p></div>
      {confirmClose ? <div className="stack"><p className="notice">This session will become read-only and cannot be resumed. It will not be marked completed or counted as a completed routine. Resolve any local recovery choice before closing.</p><div className="flex flex-wrap gap-4"><button className="button secondary" disabled={locked || busy || Boolean(recovery)} onClick={() => void closeUnfinished()}>{busy ? "Closing…" : "Close & keep history"}</button><button className="text-button" disabled={busy} onClick={() => setConfirmClose(false)}>Keep studying</button></div></div> : <button className="text-button self-start" disabled={locked || busy || Boolean(recovery)} onClick={() => { pause(); setConfirmClose(true); }}>Close unfinished session</button>}
    </section>
  </>;
}
