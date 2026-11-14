"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="page-content"><section className="card"><span className="eyebrow">LET’S TRY AGAIN</span><h1>Your learning space is unavailable.</h1><p>Check your connection and Supabase configuration. Existing saved work stays in Supabase; unfinished local drafts stay on this browser.</p><button className="button" onClick={reset}>Try again</button></section></main>;
}
