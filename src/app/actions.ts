"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, requireLearner } from "@/lib/supabase/server";
import { isUuid, validDate, validateWord, type Session } from "@/lib/model";
import { validIntervals } from "@/lib/stopwatch";

export async function signIn(_: { error: string }, form: FormData) {
  const email = form.get("email");
  const password = form.get("password");
  if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password || email.length > 254 || password.length > 1024) return { error: "Enter your email and password." };
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return { error: "Sign-in failed. Check your credentials and account confirmation, then try again." };
  } catch { return { error: "Unable to connect. Check your Supabase configuration and connection." }; }
  redirect("/");
}
export async function signOut() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error("Could not sign out. Try again.");
  redirect("/login");
}

export async function startSession(date: string, exceptional: boolean, mode = "routine", timezone = "UTC") {
  const { supabase } = await requireLearner();
  if (!validDate(date) || typeof exceptional !== "boolean") return { error: "Invalid session date." };
  const { data, error } = await supabase.rpc("start_practice_session", { p_mode: mode, p_timezone: timezone, p_exceptional: exceptional });
  if (error) return { error: "Could not start the session. Please retry." };
  revalidatePath("/");
  revalidatePath("/session");
  return { id: data as string };
}

export async function syncSession(id: string, version: number, payload: Pick<Session, "intervals" | "draft" | "chosen_words" | "exceptional_learning">) {
  const { supabase, user } = await requireLearner();
  if (!isUuid(id) || !Number.isInteger(version) || !payload || !validIntervals(payload.intervals) || ![1, 2, 3].includes(payload.chosen_words) || typeof payload.exceptional_learning !== "boolean" || typeof payload.draft !== "object" || !payload.draft || JSON.stringify(payload.draft).length > 50000) return { error: "Invalid draft. Your local copy has been kept." };
  const { data, error } = await supabase.from("study_sessions").update({ intervals: payload.intervals, draft: payload.draft, chosen_words: payload.chosen_words, exceptional_learning: payload.exceptional_learning }).eq("id", id).eq("user_id", user.id).eq("status", "draft").eq("version", version).select("version").maybeSingle();
  if (error?.code === "23514" && error.message.includes("Selected count")) return { error: "Selected count cannot be below saved words. Your local draft is kept; increase the count or reload." };
  if (error) return { error: "Cloud sync failed. Your draft is kept on this browser; retry when connected." };
  if (!data) return { error: "This draft changed elsewhere. Your local copy is kept. Reload before continuing." };
  return { version: data.version as number };
}

export async function closeSession(id: string, version: number, payload: Pick<Session, "intervals" | "draft" | "chosen_words" | "exceptional_learning">) {
  const { supabase } = await requireLearner();
  if (!isUuid(id) || !Number.isInteger(version) || !payload || !validIntervals(payload.intervals) || ![1, 2, 3].includes(payload.chosen_words) || typeof payload.exceptional_learning !== "boolean" || !payload.draft || typeof payload.draft !== "object" || JSON.stringify(payload.draft).length > 50000) return { error: "Invalid draft. Nothing was closed; your local copy is kept." };
  const { error } = await supabase.rpc("close_study_session", {
    p_session_id: id, p_version: version, p_draft: payload.draft, p_intervals: payload.intervals,
    p_chosen_words: payload.chosen_words, p_exceptional: payload.exceptional_learning,
  });
  if (error?.code === "40001") return { error: "This draft changed elsewhere. Reload before closing; your local work is kept." };
  if (error) return { error: "Could not close the session. Your draft is kept. Check the selected count and connection, then retry." };
  revalidatePath("/"); revalidatePath("/session"); revalidatePath("/words");
  return { closed: true };
}

export async function saveWord(id: string, version: number, input: unknown, intervals: unknown) {
  const { supabase } = await requireLearner();
  if (!isUuid(id) || !Number.isInteger(version) || !validIntervals(intervals)) return { error: "Invalid session timing. Your draft has been kept." };
  let word;
  try { word = validateWord(input); } catch (error) { return { error: error instanceof Error ? error.message : "Check your word details." }; }
  const { error } = await supabase.rpc("save_session_word", { p_session_id: id, p_version: version, p_word: word, p_intervals: intervals });
  if (error) {
    if (error.code === "23514" && error.message.includes("word count")) return { error: "Your selected word count has been reached. Increase it (up to 3) or close this unfinished session to start another." };
    if (error.code === "55000") return { error: "This session has been closed. Your draft is kept locally; open Session history to view the saved record." };
    if (error.code === "23505") return { error: "You have already saved this word. Find it in My Words. Your draft is kept." };
    if (error.code === "40001") return { error: "Your draft changed elsewhere. Reload before saving; your local copy is kept." };
    return { error: "Could not save to Supabase. Check the migration and connection, then retry. Your draft is kept." };
  }
  revalidatePath("/words");
  revalidatePath("/session");
  revalidatePath("/");
  return { saved: true };
}
