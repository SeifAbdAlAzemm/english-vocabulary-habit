import Link from "next/link";
import { Shell } from "@/components/shell";
import { SessionEditor } from "@/components/session-editor";
import { SessionHistory, type HistoricalSession } from "@/components/session-history";
import { StartSession } from "@/components/start-session";
import { requireLearner } from "@/lib/supabase/server";
import type { Session } from "@/lib/model";

export default async function SessionPage({ searchParams }: { searchParams: Promise<{ closed?: string }> }) {
  const { supabase, user } = await requireLearner();
  const [{ data, error }, history, params] = await Promise.all([
    supabase.from("study_sessions").select("*").eq("user_id", user.id).eq("status", "draft").maybeSingle(),
    supabase.from("study_sessions").select("*, words(count)").eq("user_id", user.id).eq("status", "closed_incomplete").order("closed_at", { ascending: false }).limit(20),
    searchParams,
  ]);
  const { data: words, error: wordsError } = data ? await supabase.from("words").select("id").eq("user_id", user.id).eq("session_id", data.id) : { data: [], error: null };
  return <Shell active="session">
    <div className="page-heading"><div><span className="eyebrow">SHOW UP. TRY. KEEP GOING.</span><h1>Your learning session</h1><p className="muted">A space for focused practice, at your own pace.</p></div><Link className="text-button" href="/">← Dashboard</Link></div>
    {params.closed === "1" && <p className="success-message" role="status">Session closed unfinished. Your work is preserved in history; saved words remain in My Words.</p>}
    {error || wordsError ? <div className="card error-message" role="alert">Could not load your draft. Apply the database migration and check your connection.</div> : data ? <SessionEditor key={data.id} initial={data as Session} savedIds={(words ?? []).map(w => w.id as string)} /> : <div className="card stack"><h2>A fresh start awaits.</h2><p>No active draft. Start a new session whenever you are ready.</p><StartSession /></div>}
    {history.error ? <p className="error-message" role="alert">Could not load session history. Check your connection.</p> : <SessionHistory sessions={(history.data ?? []) as HistoricalSession[]} />}
  </Shell>;
}
