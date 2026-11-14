"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { startSession } from "@/app/actions";
import { isReviewDay, localDate } from "@/lib/model";
import { useLocalDate } from "@/lib/use-local-date";

export function StartSession({ resume = false, mode = "routine" }: { resume?: boolean; mode?: "routine" | "review" | "MVD" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [exceptionalDate, setExceptionalDate] = useState<string | null>(null);
  const date = useLocalDate();
  async function start() {
    if (!date) return;
    setBusy(true); setError("");
    try {
      // Set before the action: revalidation can mount the editor before it returns.
      sessionStorage.setItem("start-next-session", "yes");
      // Re-read on click as well, so even a click exactly at midnight uses
      // today's local date and never carries yesterday's exception forward.
      const today = localDate();
      const result = await startSession(today, isReviewDay(today) && exceptionalDate === today, mode, Intl.DateTimeFormat().resolvedOptions().timeZone);
      if (result.error) { sessionStorage.removeItem("start-next-session"); setError(result.error); setBusy(false); }
      else { router.push("/session"); router.refresh(); }
    } catch { sessionStorage.removeItem("start-next-session"); setError("Could not connect. Please retry."); setBusy(false); }
  }
  return <div className="stack">
    {!date && <p className="fine-print" role="status">Checking your local study day…</p>}
    {!resume && mode === "routine" && date && isReviewDay(date) && <div className="weekend-note"><p>Today defaults to review-only practice.</p><label className="checkbox"><input type="checkbox" checked={exceptionalDate === date} onChange={e => setExceptionalDate(e.target.checked ? date : null)} /> I choose exceptional new-word study today.</label></div>}
    <button className="button" onClick={start} disabled={busy || !date}>{busy ? "Opening your draft…" : resume ? "Resume your draft →" : mode === "MVD" ? "Start MVD →" : mode === "review" ? "Start review session →" : "Start Your Routine Today →"}</button>
    {mode !== "routine" && <p className="fine-print">If you already have a draft, it will resume. Close it unfinished before starting a different session type.</p>}
    {error && <p className="error-message" role="alert">{error}</p>}
  </div>;
}
